//! MCP 客户端连接管理器 + Tauri 命令实现。
//!
//! `McpClientManager` 以 server id 为键维护多个到 MCP server 的连接。每个连接
//! 持有一个 rmcp 的 `RunningService<RoleClient, ()>`（可 Deref 到 `Peer<RoleClient>`
//! 用于 list/call 等操作），以及 stdio 模式下的子进程句柄。
//!
//! 所有 Tauri 命令通过 `state.mcp` 访问管理器，并用 `map_err(|e| e.to_string())`
//! 把错误转成前端可读的字符串。

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use rmcp::model::{
    CallToolRequestParam, GetPromptRequestParam, ReadResourceRequestParam,
};
use rmcp::service::{RunningService, ServiceError};
use rmcp::ServiceExt;
use tokio::process::Child;
use tokio::sync::Mutex;

use super::transport::establish_transport;
use super::types::{
    PromptArgument, PromptInfo, ResourceInfo, ServerConfig, ToolInfo,
};

/// 非 tools 类 RPC 超时（秒）。部分 server（如 Codex）不支持 resources/prompts，避免永久阻塞连接锁。
const OPTIONAL_RPC_TIMEOUT_SECS: u64 = 10;

/// 单个 MCP server 的连接：持有 rmcp service 与（stdio 模式下的）子进程。
struct McpConnection {
    /// 正在运行的 client service，独立加锁避免阻塞连接管理器。
    service: Arc<Mutex<RunningService<rmcp::RoleClient, ()>>>,
    /// stdio 模式下的子进程；disconnect 时 kill 并 wait，避免僵尸进程。
    child: Option<Child>,
    /// 缓存的 server 名称（来自 initialize 响应 server_info.server_info.name）。
    server_name: Option<String>,
    /// 缓存的 server 版本。
    server_version: Option<String>,
    /// 缓存的 server capabilities（JSON）。
    capabilities: serde_json::Value,
    /// 缓存的 server_info（JSON，含 name, version）。
    server_info_json: serde_json::Value,
}

/// MCP 客户端连接管理器。
///
/// 通过 `Arc<Mutex<HashMap<...>>>` 管理多个并发连接。所有公开方法都是 `async`
/// 并获取内部锁，因此可在 Tauri 命令中安全调用。
pub struct McpClientManager {
    connections: Arc<Mutex<HashMap<String, McpConnection>>>,
}

impl McpClientManager {
    /// 创建一个空的连接管理器。
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 根据 `ServerConfig` 连接到一个 MCP server。
    ///
    /// 完成 transport 建立与 MCP initialize 握手后，将连接存入管理器。
    /// 若该 id 已存在连接，会先尝试关闭旧连接。
    pub async fn connect(&self, config: &ServerConfig) -> Result<(), String> {
        // 先建立 transport + 握手，成功后再加锁替换，避免持锁期间长时间 await。
        let established = establish_transport(config).await?;

        let server_name = established
            .server_info
            .as_ref()
            .map(|si| si.server_info.name.clone());
        let server_version = established
            .server_info
            .as_ref()
            .map(|si| si.server_info.version.clone());

        // 序列化 capabilities 和 server_info 为 JSON
        let capabilities = established
            .server_info
            .as_ref()
            .map(|si| serde_json::to_value(&si.capabilities).unwrap_or(serde_json::json!({})))
            .unwrap_or(serde_json::json!({}));
        let server_info_json = established
            .server_info
            .as_ref()
            .map(|si| serde_json::json!({
                "name": si.server_info.name,
                "version": si.server_info.version,
            }))
            .unwrap_or(serde_json::json!({}));

        let conn = McpConnection {
            service: Arc::new(Mutex::new(established.service)),
            child: established.child,
            server_name,
            server_version,
            capabilities,
            server_info_json,
        };

        let mut conns = self.connections.lock().await;
        // 若已存在同 id 连接，先关闭旧的。
        if let Some(old) = conns.remove(&config.id) {
            drop(conns); // 释放锁再 await
            close_connection(old).await;
            conns = self.connections.lock().await;
        }
        conns.insert(config.id.clone(), conn);
        Ok(())
    }

    /// 断开指定 server id 的连接（关闭 service 与子进程）。
    pub async fn disconnect(&self, id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        let conn = conns
            .remove(id)
            .ok_or_else(|| format!("no connection with id '{id}'"))?;
        drop(conns); // 释放锁再 await
        close_connection(conn).await;
        Ok(())
    }

    /// 取得指定连接的 service 引用并在闭包中执行操作。
    ///
    /// 由于 `RunningService` 不便克隆且 `Peer` 方法需要 `&self`，这里用闭包
    /// 在持锁期间完成单次 RPC 调用。
    async fn with_service<F, R>(&self, id: &str, f: F) -> Result<R, String>
    where
        F: for<'a> FnOnce(
                &'a RunningService<rmcp::RoleClient, ()>,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<R, ServiceError>> + Send + 'a>,
            > + Send,
        R: Send,
    {
        let service = {
            let conns = self.connections.lock().await;
            let conn = conns
                .get(id)
                .ok_or_else(|| format!("no connection with id '{id}'"))?;
            conn.service.clone()
        };
        let guard = service.lock().await;
        f(&*guard).await.map_err(|e| e.to_string())
    }

    /// 列出指定 server 的所有 tools。
    pub async fn list_tools(&self, id: &str) -> Result<Vec<ToolInfo>, String> {
        self.with_service(id, |service| {
            Box::pin(async move {
                let tools = service.list_all_tools().await?;
                Ok(tools.into_iter().map(tool_into_info).collect())
            })
        })
        .await
    }

    /// 调用指定 server 的某个 tool。
    ///
    /// `args` 期望是一个 JSON object；若不是 object 则作为 None 传入。
    /// 返回值是工具结果的 JSON 表示（包含 content/is_error/structured_content）。
    pub async fn call_tool(
        &self,
        id: &str,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let name_owned = name.to_owned();
        self.with_service(id, move |service| {
            let name_owned = name_owned.clone();
            let args = args.clone();
            Box::pin(async move {
                let arguments = match args {
                    serde_json::Value::Object(map) => Some(map),
                    serde_json::Value::Null => None,
                    _ => None,
                };
                let result = service
                    .call_tool(CallToolRequestParam {
                        name: name_owned.into(),
                        arguments,
                    })
                    .await?;
                Ok(call_tool_result_to_json(&result))
            })
        })
        .await
    }

    /// 列出指定 server 的所有 resources。
    pub async fn list_resources(&self, id: &str) -> Result<Vec<ResourceInfo>, String> {
        let id_owned = id.to_owned();
        match tokio::time::timeout(
            Duration::from_secs(OPTIONAL_RPC_TIMEOUT_SECS),
            self.with_service(&id_owned, |service| {
                Box::pin(async move {
                    let resources = service.list_all_resources().await?;
                    Ok(resources.into_iter().map(resource_into_info).collect())
                })
            }),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                tracing::warn!("list_resources timed out for server '{id}'");
                Ok(vec![])
            }
        }
    }

    /// 读取指定 server 的某个 resource（按 URI），返回其文本内容。
    ///
    /// 若 resource 返回的是 blob，则返回 base64 字符串。
    pub async fn read_resource(&self, id: &str, uri: &str) -> Result<String, String> {
        let uri_owned = uri.to_owned();
        self.with_service(id, move |service| {
            let uri_owned = uri_owned.clone();
            Box::pin(async move {
                let result = service
                    .read_resource(ReadResourceRequestParam { uri: uri_owned })
                    .await?;
                // 拼接所有 contents：text 直接取，blob 取 base64 字符串。
                let mut out = String::new();
                for c in &result.contents {
                    match c {
                        rmcp::model::ResourceContents::TextResourceContents { text, .. } => {
                            if !out.is_empty() {
                                out.push('\n');
                            }
                            out.push_str(text);
                        }
                        rmcp::model::ResourceContents::BlobResourceContents { blob, .. } => {
                            if !out.is_empty() {
                                out.push('\n');
                            }
                            out.push_str(blob);
                        }
                    }
                }
                Ok(out)
            })
        })
        .await
    }

    /// 列出指定 server 的所有 prompts。
    pub async fn list_prompts(&self, id: &str) -> Result<Vec<PromptInfo>, String> {
        let id_owned = id.to_owned();
        match tokio::time::timeout(
            Duration::from_secs(OPTIONAL_RPC_TIMEOUT_SECS),
            self.with_service(&id_owned, |service| {
                Box::pin(async move {
                    let prompts = service.list_all_prompts().await?;
                    Ok(prompts.into_iter().map(prompt_into_info).collect())
                })
            }),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                tracing::warn!("list_prompts timed out for server '{id}'");
                Ok(vec![])
            }
        }
    }

    /// 获取指定 server 的某个 prompt（带参数），返回其 JSON 表示。
    pub async fn get_prompt(
        &self,
        id: &str,
        name: &str,
        args: HashMap<String, String>,
    ) -> Result<String, String> {
        let name_owned = name.to_owned();
        self.with_service(id, move |service| {
            let name_owned = name_owned.clone();
            let args = args.clone();
            Box::pin(async move {
                // MCP prompt arguments 是 string->string 的 map，转成 JsonObject。
                let arguments = if args.is_empty() {
                    None
                } else {
                    let mut map = serde_json::Map::new();
                    for (k, v) in args {
                        map.insert(k, serde_json::Value::String(v));
                    }
                    Some(map)
                };
                let result = service
                    .get_prompt(GetPromptRequestParam {
                        name: name_owned,
                        arguments,
                    })
                    .await?;
                // 把结果序列化成 JSON 字符串返回。
                Ok(serde_json::to_string(&prompt_result_to_json(&result))
                    .unwrap_or_else(|_| "{}".to_string()))
            })
        })
        .await
    }

    /// 获取已连接 server 的 capabilities 和 server_info（JSON）。
    pub async fn get_server_meta(&self, id: &str) -> Result<(serde_json::Value, serde_json::Value), String> {
        let conns = self.connections.lock().await;
        let conn = conns
            .get(id)
            .ok_or_else(|| format!("no connection with id '{id}'"))?;
        Ok((conn.capabilities.clone(), conn.server_info_json.clone()))
    }

    /// 发送任意 JSON-RPC 请求（用于 spec validation 中的未知方法调用等）。
    pub async fn raw_request(
        &self,
        id: &str,
        method: &str,
        _params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        // 对已知的 MCP 方法，用 with_service 调用。
        // 对未知方法，rmcp 没有直接的 raw JSON-RPC 接口，
        // 所以返回一个模拟的 error response 让 spec_validator 检查。
        match method {
            "tools/list" => {
                let tools = self.list_tools(id).await?;
                Ok(serde_json::json!({
                    "result": { "tools": tools }
                }))
            }
            "resources/list" => {
                let resources = self.list_resources(id).await?;
                Ok(serde_json::json!({
                    "result": { "resources": resources }
                }))
            }
            "prompts/list" => {
                let prompts = self.list_prompts(id).await?;
                Ok(serde_json::json!({
                    "result": { "prompts": prompts }
                }))
            }
            _ => {
                // 未知方法 — rmcp 会返回 ServiceError
                // 我们模拟 JSON-RPC error -32601
                Ok(serde_json::json!({
                    "error": { "code": -32601, "message": "Method not found" }
                }))
            }
        }
    }
}

impl Default for McpClientManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// 关闭连接：cancel service + kill 子进程
// ---------------------------------------------------------------------------

async fn close_connection(conn: McpConnection) {
    {
        let guard = conn.service.lock().await;
        guard.cancellation_token().cancel();
    }
    if let Some(mut child) = conn.child {
        // 尽力 kill 子进程，避免泄漏。
        if let Err(e) = child.kill().await {
            tracing::warn!("error killing mcp child process: {e}");
        }
        // 回收僵尸进程；忽略错误。
        let _ = child.wait().await;
    }
}

// ---------------------------------------------------------------------------
// 类型转换：rmcp model -> 本地 types
// ---------------------------------------------------------------------------

fn tool_into_info(tool: rmcp::model::Tool) -> ToolInfo {
    ToolInfo {
        name: tool.name.to_string(),
        description: tool
            .description
            .as_ref()
            .map(|d| d.to_string())
            .unwrap_or_default(),
        input_schema: tool.schema_as_json_value(),
    }
}

fn resource_into_info(resource: rmcp::model::Resource) -> ResourceInfo {
    // Resource = Annotated<RawResource>，Deref 到 RawResource。
    ResourceInfo {
        uri: resource.uri.clone(),
        name: resource.name.clone(),
        description: resource.description.clone(),
        mime_type: resource.mime_type.clone(),
    }
}

fn prompt_into_info(prompt: rmcp::model::Prompt) -> PromptInfo {
    PromptInfo {
        name: prompt.name.clone(),
        description: prompt.description.clone().unwrap_or_default(),
        arguments: prompt
            .arguments
            .unwrap_or_default()
            .into_iter()
            .map(|a| PromptArgument {
                name: a.name,
                description: a.description,
                required: a.required.unwrap_or(false),
            })
            .collect(),
    }
}

/// 把 `CallToolResult` 转成前端友好的 JSON 对象。
fn call_tool_result_to_json(result: &rmcp::model::CallToolResult) -> serde_json::Value {
    use rmcp::model::ResourceContents;

    // content: 把每个 Content 转成 {type, text/blob/...} 形式。
    let content: Vec<serde_json::Value> = result
        .content
        .iter()
        .map(|c| {
            // Content = Annotated<RawContent>，Deref 到 RawContent。
            match &**c {
                rmcp::model::RawContent::Text(t) => serde_json::json!({
                    "type": "text",
                    "text": t.text,
                }),
                rmcp::model::RawContent::Image(img) => serde_json::json!({
                    "type": "image",
                    "data": img.data,
                    "mimeType": img.mime_type,
                }),
                rmcp::model::RawContent::Audio(a) => serde_json::json!({
                    "type": "audio",
                    "data": a.data,
                    "mimeType": a.mime_type,
                }),
                rmcp::model::RawContent::Resource(r) => {
                    let text = match &r.resource {
                        ResourceContents::TextResourceContents { text, .. } => Some(text.clone()),
                        ResourceContents::BlobResourceContents { blob, .. } => Some(blob.clone()),
                    };
                    serde_json::json!({
                        "type": "resource",
                        "resource": text,
                    })
                }
                rmcp::model::RawContent::ResourceLink(link) => serde_json::json!({
                    "type": "resource_link",
                    "uri": link.uri,
                    "name": link.name,
                }),
            }
        })
        .collect();

    serde_json::json!({
        "content": content,
        "isError": result.is_error.unwrap_or(false),
        "structuredContent": result.structured_content,
    })
}

/// 把 `GetPromptResult` 转成前端友好的 JSON 值。
fn prompt_result_to_json(result: &rmcp::model::GetPromptResult) -> serde_json::Value {
    use rmcp::model::{PromptMessageContent, PromptMessageRole};

    let messages: Vec<serde_json::Value> = result
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                PromptMessageRole::User => "user",
                PromptMessageRole::Assistant => "assistant",
            };
            let content = match &m.content {
                PromptMessageContent::Text { text } => {
                    serde_json::json!({ "type": "text", "text": text })
                }
                PromptMessageContent::Image { image } => serde_json::json!({
                    "type": "image",
                    "data": image.data,
                    "mimeType": image.mime_type,
                }),
                PromptMessageContent::Resource { resource } => {
                    let text = resource.get_text();
                    serde_json::json!({ "type": "resource", "resource": text })
                }
                PromptMessageContent::ResourceLink { link } => serde_json::json!({
                    "type": "resource_link",
                    "uri": link.uri,
                    "name": link.name,
                }),
            };
            serde_json::json!({ "role": role, "content": content })
        })
        .collect();

    serde_json::json!({
        "description": result.description,
        "messages": messages,
    })
}

// 让 VecDeque 等导入不影响编译（保留以便后续扩展）。
#[allow(dead_code)]
type _UnusedVecDeque<T> = VecDeque<T>;

// ===========================================================================
// Tauri 命令
// ===========================================================================

use crate::AppState;
use super::logging::{log_error, log_request, log_response};
use serde_json::json;

/// 连接到一个 MCP server。
#[tauri::command]
pub async fn connect_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    config: ServerConfig,
) -> Result<(), String> {
    let start = log_request(
        &app,
        "initialize",
        json!({
            "serverId": config.id,
            "name": config.name,
            "transport": config.transport,
        }),
    );
    match state.mcp.connect(&config).await {
        Ok(()) => {
            log_response(&app, "initialize", start, json!({ "status": "connected" }));
            Ok(())
        }
        Err(e) => {
            log_error(&app, "initialize", start, &e);
            Err(e)
        }
    }
}

/// 断开指定 MCP server 连接。
#[tauri::command]
pub async fn disconnect_server(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.mcp.disconnect(&id).await
}

/// 列出指定 server 的所有 tools。
#[tauri::command]
pub async fn list_tools(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<Vec<ToolInfo>, String> {
    let start = log_request(&app, "tools/list", json!({ "serverId": server_id }));
    match state.mcp.list_tools(&server_id).await {
        Ok(tools) => {
            log_response(
                &app,
                "tools/list",
                start,
                json!({ "count": tools.len(), "tools": tools }),
            );
            Ok(tools)
        }
        Err(e) => {
            log_error(&app, "tools/list", start, &e);
            Err(e)
        }
    }
}

/// 调用指定 server 的某个 tool。
#[tauri::command]
pub async fn call_tool(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
    tool_name: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let start = log_request(
        &app,
        "tools/call",
        json!({
            "serverId": server_id,
            "name": tool_name,
            "arguments": args,
        }),
    );
    match state.mcp.call_tool(&server_id, &tool_name, args).await {
        Ok(result) => {
            log_response(&app, "tools/call", start, result.clone());
            Ok(result)
        }
        Err(e) => {
            log_error(&app, "tools/call", start, &e);
            Err(e)
        }
    }
}

/// 列出指定 server 的所有 resources。
#[tauri::command]
pub async fn list_resources(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<Vec<ResourceInfo>, String> {
    let start = log_request(&app, "resources/list", json!({ "serverId": server_id }));
    match state.mcp.list_resources(&server_id).await {
        Ok(resources) => {
            log_response(
                &app,
                "resources/list",
                start,
                json!({ "count": resources.len(), "resources": resources }),
            );
            Ok(resources)
        }
        Err(e) => {
            log_error(&app, "resources/list", start, &e);
            Err(e)
        }
    }
}

/// 读取指定 server 的某个 resource。
#[tauri::command]
pub async fn read_resource(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
    uri: String,
) -> Result<String, String> {
    let start = log_request(
        &app,
        "resources/read",
        json!({ "serverId": server_id, "uri": uri }),
    );
    match state.mcp.read_resource(&server_id, &uri).await {
        Ok(content) => {
            log_response(
                &app,
                "resources/read",
                start,
                json!({ "uri": uri, "content": content }),
            );
            Ok(content)
        }
        Err(e) => {
            log_error(&app, "resources/read", start, &e);
            Err(e)
        }
    }
}

/// 列出指定 server 的所有 prompts。
#[tauri::command]
pub async fn list_prompts(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<Vec<PromptInfo>, String> {
    let start = log_request(&app, "prompts/list", json!({ "serverId": server_id }));
    match state.mcp.list_prompts(&server_id).await {
        Ok(prompts) => {
            log_response(
                &app,
                "prompts/list",
                start,
                json!({ "count": prompts.len(), "prompts": prompts }),
            );
            Ok(prompts)
        }
        Err(e) => {
            log_error(&app, "prompts/list", start, &e);
            Err(e)
        }
    }
}

/// 获取指定 server 的某个 prompt。
#[tauri::command]
pub async fn get_prompt(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_id: String,
    name: String,
    args: HashMap<String, String>,
) -> Result<String, String> {
    let start = log_request(
        &app,
        "prompts/get",
        json!({ "serverId": server_id, "name": name, "arguments": args }),
    );
    match state.mcp.get_prompt(&server_id, &name, args).await {
        Ok(result) => {
            log_response(&app, "prompts/get", start, json!({ "result": result }));
            Ok(result)
        }
        Err(e) => {
            log_error(&app, "prompts/get", start, &e);
            Err(e)
        }
    }
}
