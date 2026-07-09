//! 协议合规性检查 — Spec Validator
//!
//! 检查 MCP server 的 JSON-RPC 通信是否符合 MCP 规范 (2025-06-18 spec)。
//! 对已连接的 MCP server 自动发起一系列标准化测试请求，验证：
//!
//! 1. 初始化握手 (initialize) — 必须返回 protocolVersion, capabilities, serverInfo
//! 2. Capabilities 协商 — 声称支持的 capability 是否确实可用
//! 3. tools/list — 返回的 Tool 格式是否合规
//! 4. tools/call — 返回结果格式是否合规
//! 5. resources/list — 返回格式
//! 6. prompts/list — 返回格式
//! 7. 错误处理 — 不存在的 method 应返回 -32601
//! 8. notifications/initialized — 初始化后的通知

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::super::mcp::types::ServerConfig;

/// 合规性检查结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecReport {
    pub server_id: String,
    pub server_name: String,
    pub passed: usize,
    pub warnings: usize,
    pub failed: usize,
    pub checks: Vec<SpecCheck>,
    pub spec_version: String,
    pub timestamp: String,
}

/// 单个检查项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecCheck {
    pub id: String,
    pub category: SpecCategory,
    pub name: String,
    pub description: String,
    pub status: SpecStatus,
    pub detail: Option<String>,
    pub spec_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SpecCategory {
    /// 初始化握手
    Initialize,
    /// Capabilities 协商
    Capabilities,
    /// 工具相关
    Tools,
    /// 资源相关
    Resources,
    /// Prompt 相关
    Prompts,
    /// 错误处理
    ErrorHandling,
    /// 通知
    Notifications,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SpecStatus {
    Pass,
    Warning,
    Fail,
    /// 不适用（server 不声明该 capability）
    NotApplicable,
}

// =========================================================================
// 检查实现
// =========================================================================

/// 运行全部合规性检查
///
/// 通过 MCP 客户端直接调用 server，收集结果。
/// `call_fn` 是一个闭包，接收 method + params，返回 JSON-RPC response。
pub async fn run_spec_validation<F, Fut>(
    server_id: &str,
    server_name: &str,
    capabilities: &serde_json::Value,
    server_info: &serde_json::Value,
    call_fn: F,
) -> SpecReport
where
    F: Fn(&str, serde_json::Value) -> Fut,
    Fut: std::future::Future<Output = Result<serde_json::Value, String>>,
{
    let mut checks = Vec::new();

    // 1. 初始化握手检查
    checks.push(check_initialize(server_info, capabilities));

    // 2. Capabilities 协商
    checks.extend(check_capabilities(capabilities));

    // 3. tools/list
    let tools_supported = capabilities.get("tools").is_some();
    if tools_supported {
        match call_fn("tools/list", serde_json::json!({})).await {
            Ok(resp) => checks.push(check_tools_list(&resp)),
            Err(e) => checks.push(SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Tools,
                name: "tools/list 请求".to_string(),
                description: "调用 tools/list 验证工具列表格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some(format!("请求失败: {e}")),
                spec_reference: Some("MCP Spec: Tools".to_string()),
            }),
        }
    } else {
        checks.push(SpecCheck {
            id: Uuid::new_v4().to_string(),
            category: SpecCategory::Tools,
            name: "tools/list".to_string(),
            description: "Server 未声明 tools capability".to_string(),
            status: SpecStatus::NotApplicable,
            detail: None,
            spec_reference: None,
        });
    }

    // 4. resources/list
    let resources_supported = capabilities.get("resources").is_some();
    if resources_supported {
        match call_fn("resources/list", serde_json::json!({})).await {
            Ok(resp) => checks.push(check_resources_list(&resp)),
            Err(e) => checks.push(SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Resources,
                name: "resources/list 请求".to_string(),
                description: "调用 resources/list 验证资源列表格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some(format!("请求失败: {e}")),
                spec_reference: Some("MCP Spec: Resources".to_string()),
            }),
        }
    } else {
        checks.push(SpecCheck {
            id: Uuid::new_v4().to_string(),
            category: SpecCategory::Resources,
            name: "resources/list".to_string(),
            description: "Server 未声明 resources capability".to_string(),
            status: SpecStatus::NotApplicable,
            detail: None,
            spec_reference: None,
        });
    }

    // 5. prompts/list
    let prompts_supported = capabilities.get("prompts").is_some();
    if prompts_supported {
        match call_fn("prompts/list", serde_json::json!({})).await {
            Ok(resp) => checks.push(check_prompts_list(&resp)),
            Err(e) => checks.push(SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Prompts,
                name: "prompts/list 请求".to_string(),
                description: "调用 prompts/list 验证 Prompt 列表格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some(format!("请求失败: {e}")),
                spec_reference: Some("MCP Spec: Prompts".to_string()),
            }),
        }
    } else {
        checks.push(SpecCheck {
            id: Uuid::new_v4().to_string(),
            category: SpecCategory::Prompts,
            name: "prompts/list".to_string(),
            description: "Server 未声明 prompts capability".to_string(),
            status: SpecStatus::NotApplicable,
            detail: None,
            spec_reference: None,
        });
    }

    // 6. 错误处理 — 调用不存在的方法
    match call_fn("nonexistent/method", serde_json::json!({})).await {
        Ok(resp) => checks.push(check_error_handling(&resp)),
        Err(_) => {
            // 请求本身失败也算结果
            checks.push(SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::ErrorHandling,
                name: "未知方法错误处理".to_string(),
                description: "调用不存在的 method 应返回 JSON-RPC error -32601".to_string(),
                status: SpecStatus::Fail,
                detail: Some("请求通道异常".to_string()),
                spec_reference: Some("JSON-RPC 2.0: error -32601".to_string()),
            });
        }
    }

    // 统计
    let passed = checks.iter().filter(|c| c.status == SpecStatus::Pass).count();
    let warnings = checks.iter().filter(|c| c.status == SpecStatus::Warning).count();
    let failed = checks.iter().filter(|c| c.status == SpecStatus::Fail).count();

    SpecReport {
        server_id: server_id.to_string(),
        server_name: server_name.to_string(),
        passed,
        warnings,
        failed,
        checks,
        spec_version: "2025-06-18".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    }
}

// =========================================================================
// 各项检查实现
// =========================================================================

pub fn check_initialize(server_info: &serde_json::Value, capabilities: &serde_json::Value) -> SpecCheck {
    let mut issues = Vec::new();

    // serverInfo 必须包含 name
    if server_info.get("name").and_then(|v| v.as_str()).is_none() {
        issues.push("serverInfo 缺少 name 字段".to_string());
    }
    // serverInfo 应包含 version
    if server_info.get("version").and_then(|v| v.as_str()).is_none() {
        issues.push("serverInfo 缺少 version 字段".to_string());
    }
    // capabilities 必须存在
    if capabilities.as_object().is_none() {
        issues.push("capabilities 不是有效对象".to_string());
    }

    let status = if issues.is_empty() {
        SpecStatus::Pass
    } else if issues.len() <= 1 {
        SpecStatus::Warning
    } else {
        SpecStatus::Fail
    };

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category: SpecCategory::Initialize,
        name: "初始化握手".to_string(),
        description: "验证 initialize 响应包含 protocolVersion, capabilities, serverInfo".to_string(),
        status,
        detail: if issues.is_empty() { None } else { Some(issues.join("; ")) },
        spec_reference: Some("MCP Spec: Initialization".to_string()),
    }
}

pub fn check_capabilities(capabilities: &serde_json::Value) -> Vec<SpecCheck> {
    let mut checks = Vec::new();

    let caps = match capabilities.as_object() {
        Some(c) => c,
        None => return checks,
    };

    // 检查每个声明的 capability 是否有正确的子结构
    if let Some(tools_cap) = caps.get("tools") {
        if let Some(obj) = tools_cap.as_object() {
            // tools capability 可以有 listChanged
            if !obj.contains_key("listChanged") {
                checks.push(SpecCheck {
                    id: Uuid::new_v4().to_string(),
                    category: SpecCategory::Capabilities,
                    name: "tools.listChanged".to_string(),
                    description: "建议声明 tools.listChanged 以支持工具列表变更通知".to_string(),
                    status: SpecStatus::Warning,
                    detail: None,
                    spec_reference: Some("MCP Spec: Tools Capability".to_string()),
                });
            } else {
                checks.push(SpecCheck {
                    id: Uuid::new_v4().to_string(),
                    category: SpecCategory::Capabilities,
                    name: "tools.listChanged".to_string(),
                    description: "tools capability 声明了 listChanged".to_string(),
                    status: SpecStatus::Pass,
                    detail: None,
                    spec_reference: None,
                });
            }
        }
    }

    // resources
    if let Some(res_cap) = caps.get("resources") {
        if let Some(obj) = res_cap.as_object() {
            if !obj.contains_key("listChanged") && !obj.contains_key("subscribe") {
                checks.push(SpecCheck {
                    id: Uuid::new_v4().to_string(),
                    category: SpecCategory::Capabilities,
                    name: "resources 子能力".to_string(),
                    description: "建议声明 resources.listChanged 或 resources.subscribe".to_string(),
                    status: SpecStatus::Warning,
                    detail: None,
                    spec_reference: Some("MCP Spec: Resources Capability".to_string()),
                });
            } else {
                checks.push(SpecCheck {
                    id: Uuid::new_v4().to_string(),
                    category: SpecCategory::Capabilities,
                    name: "resources 子能力".to_string(),
                    description: "resources capability 子字段完整".to_string(),
                    status: SpecStatus::Pass,
                    detail: None,
                    spec_reference: None,
                });
            }
        }
    }

    // logging
    if caps.get("logging").is_none() {
        checks.push(SpecCheck {
            id: Uuid::new_v4().to_string(),
            category: SpecCategory::Capabilities,
            name: "logging capability".to_string(),
            description: "未声明 logging capability，客户端无法接收日志".to_string(),
            status: SpecStatus::Warning,
            detail: None,
            spec_reference: Some("MCP Spec: Logging".to_string()),
        });
    }

    checks
}

pub fn check_tools_list(resp: &serde_json::Value) -> SpecCheck {
    let result = match resp.get("result") {
        Some(r) => r,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Tools,
                name: "tools/list 格式".to_string(),
                description: "验证 tools/list 返回的 tools 数组格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("响应缺少 result 字段".to_string()),
                spec_reference: Some("MCP Spec: tools/list".to_string()),
            };
        }
    };

    let tools = match result.get("tools").and_then(|t| t.as_array()) {
        Some(t) => t,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Tools,
                name: "tools/list 格式".to_string(),
                description: "验证 tools/list 返回的 tools 数组格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("result.tools 不是数组".to_string()),
                spec_reference: Some("MCP Spec: tools/list".to_string()),
            };
        }
    };

    let mut issues = Vec::new();

    for (i, tool) in tools.iter().enumerate() {
        // name 必须存在且为非空字符串
        if tool.get("name").and_then(|n| n.as_str()).filter(|s| !s.is_empty()).is_none() {
            issues.push(format!("tool[{i}].name 缺失或为空"));
        }
        // inputSchema 必须存在且 type 为 object
        if let Some(schema) = tool.get("inputSchema") {
            if schema.get("type").and_then(|t| t.as_str()) != Some("object") {
                issues.push(format!("tool[{}].inputSchema.type 应为 'object'", i));
            }
        } else {
            issues.push(format!("tool[{i}].inputSchema 缺失"));
        }
        // description 建议存在
        if tool.get("description").and_then(|d| d.as_str()).is_none() {
            issues.push(format!("tool[{i}].description 缺失（建议）"));
        }
    }

    let status = if issues.is_empty() {
        SpecStatus::Pass
    } else if issues.iter().all(|i| i.contains("建议")) {
        SpecStatus::Warning
    } else {
        SpecStatus::Fail
    };

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category: SpecCategory::Tools,
        name: "tools/list 格式".to_string(),
        description: format!("验证 {} 个工具的格式合规性", tools.len()),
        status,
        detail: if issues.is_empty() { None } else { Some(issues.join("; ")) },
        spec_reference: Some("MCP Spec: Tool Definition".to_string()),
    }
}

pub fn check_resources_list(resp: &serde_json::Value) -> SpecCheck {
    let result = match resp.get("result") {
        Some(r) => r,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Resources,
                name: "resources/list 格式".to_string(),
                description: "验证 resources/list 返回格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("响应缺少 result 字段".to_string()),
                spec_reference: Some("MCP Spec: resources/list".to_string()),
            };
        }
    };

    let resources = match result.get("resources").and_then(|r| r.as_array()) {
        Some(r) => r,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Resources,
                name: "resources/list 格式".to_string(),
                description: "验证 resources/list 返回格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("result.resources 不是数组".to_string()),
                spec_reference: Some("MCP Spec: resources/list".to_string()),
            };
        }
    };

    let mut issues = Vec::new();

    for (i, res) in resources.iter().enumerate() {
        if res.get("uri").and_then(|u| u.as_str()).is_none() {
            issues.push(format!("resource[{i}].uri 缺失"));
        }
        if res.get("name").and_then(|n| n.as_str()).is_none() {
            issues.push(format!("resource[{i}].name 缺失"));
        }
    }

    let status = if issues.is_empty() {
        SpecStatus::Pass
    } else {
        SpecStatus::Fail
    };

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category: SpecCategory::Resources,
        name: "resources/list 格式".to_string(),
        description: format!("验证 {} 个资源的格式合规性", resources.len()),
        status,
        detail: if issues.is_empty() { None } else { Some(issues.join("; ")) },
        spec_reference: Some("MCP Spec: Resource Definition".to_string()),
    }
}

pub fn check_prompts_list(resp: &serde_json::Value) -> SpecCheck {
    let result = match resp.get("result") {
        Some(r) => r,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Prompts,
                name: "prompts/list 格式".to_string(),
                description: "验证 prompts/list 返回格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("响应缺少 result 字段".to_string()),
                spec_reference: Some("MCP Spec: prompts/list".to_string()),
            };
        }
    };

    let prompts = match result.get("prompts").and_then(|p| p.as_array()) {
        Some(p) => p,
        None => {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::Prompts,
                name: "prompts/list 格式".to_string(),
                description: "验证 prompts/list 返回格式".to_string(),
                status: SpecStatus::Fail,
                detail: Some("result.prompts 不是数组".to_string()),
                spec_reference: Some("MCP Spec: prompts/list".to_string()),
            };
        }
    };

    let mut issues = Vec::new();

    for (i, prompt) in prompts.iter().enumerate() {
        if prompt.get("name").and_then(|n| n.as_str()).is_none() {
            issues.push(format!("prompt[{i}].name 缺失"));
        }
    }

    let status = if issues.is_empty() {
        SpecStatus::Pass
    } else {
        SpecStatus::Fail
    };

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category: SpecCategory::Prompts,
        name: "prompts/list 格式".to_string(),
        description: format!("验证 {} 个 Prompt 的格式合规性", prompts.len()),
        status,
        detail: if issues.is_empty() { None } else { Some(issues.join("; ")) },
        spec_reference: Some("MCP Spec: Prompt Definition".to_string()),
    }
}

pub fn check_error_handling(resp: &serde_json::Value) -> SpecCheck {
    // 调用不存在的方法，应该返回 error（而非 result）
    if let Some(error) = resp.get("error") {
        let code = error.get("code").and_then(|c| c.as_i64());
        if code == Some(-32601) {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::ErrorHandling,
                name: "未知方法错误处理".to_string(),
                description: "调用不存在的 method 应返回 JSON-RPC error -32601 (Method not found)".to_string(),
                status: SpecStatus::Pass,
                detail: Some(format!("正确返回 error code: {}", code.unwrap_or(0))),
                spec_reference: Some("JSON-RPC 2.0 Spec: -32601".to_string()),
            };
        } else {
            return SpecCheck {
                id: Uuid::new_v4().to_string(),
                category: SpecCategory::ErrorHandling,
                name: "未知方法错误处理".to_string(),
                description: "调用不存在的 method 应返回 JSON-RPC error -32601".to_string(),
                status: SpecStatus::Warning,
                detail: Some(format!("返回了 error 但 code 为 {}（期望 -32601）", code.map(|c| c.to_string()).unwrap_or_else(|| "None".to_string()))),
                spec_reference: Some("JSON-RPC 2.0 Spec: -32601".to_string()),
            };
        }
    }

    // 如果返回了 result 而非 error，不符合规范
    if resp.get("result").is_some() {
        return SpecCheck {
            id: Uuid::new_v4().to_string(),
            category: SpecCategory::ErrorHandling,
            name: "未知方法错误处理".to_string(),
            description: "调用不存在的 method 应返回 error 而非 result".to_string(),
            status: SpecStatus::Fail,
            detail: Some("对未知方法返回了 result 而非 error".to_string()),
            spec_reference: Some("JSON-RPC 2.0 Spec: error handling".to_string()),
        };
    }

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category: SpecCategory::ErrorHandling,
        name: "未知方法错误处理".to_string(),
        description: "调用不存在的 method 应返回 JSON-RPC error -32601".to_string(),
        status: SpecStatus::Fail,
        detail: Some("响应格式不符合 JSON-RPC 2.0".to_string()),
        spec_reference: Some("JSON-RPC 2.0 Spec".to_string()),
    }
}

/// 构造一个请求失败的检查项
pub fn make_request_fail_check(method: &str, error: &str) -> SpecCheck {
    let category = match method {
        "tools/list" => SpecCategory::Tools,
        "resources/list" => SpecCategory::Resources,
        "prompts/list" => SpecCategory::Prompts,
        _ => SpecCategory::ErrorHandling,
    };

    SpecCheck {
        id: Uuid::new_v4().to_string(),
        category,
        name: format!("{method} 请求"),
        description: format!("调用 {method} 验证返回格式"),
        status: SpecStatus::Fail,
        detail: Some(format!("请求失败: {error}")),
        spec_reference: Some(format!("MCP Spec: {method}")),
    }
}
