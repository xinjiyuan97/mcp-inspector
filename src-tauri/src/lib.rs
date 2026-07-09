mod mcp;
mod diag;
mod proxy;

use mcp::client::McpClientManager;
use mcp::types::{ServerConfig, ToolInfo};
use diag::invocation::{run_invocation_test, run_comparison, ComparisonResult};
use diag::llm_adapter::LlmConfig;
use diag::spec_validator::{SpecReport, SpecStatus};
use diag::optimizer::{DescriptionOptimization, BatchLintResult};
use diag::recording::{RecordingManager, SessionRecording, RecordedMessage};
use proxy::stdio_proxy::{ProxyManager, ProxyInfo};
use proxy::http_proxy::{HttpProxyManager, HttpProxyInfo};

pub struct AppState {
    pub mcp: McpClientManager,
    pub stdio_proxy: ProxyManager,
    pub http_proxy: HttpProxyManager,
    pub recording: RecordingManager,
}

// =========================================================================
// 诊断命令
// =========================================================================

/// Layer 1 静态分析
#[tauri::command]
fn lint_tool(tool: ToolInfo) -> Result<diag::linter::LintReport, String> {
    Ok(diag::linter::lint(&tool))
}

/// Layer 3 单模型调用测试
#[tauri::command]
async fn test_invocation(
    llm_config: LlmConfig,
    tool: ToolInfo,
    prompt: String,
) -> Result<diag::invocation::InvocationResult, String> {
    run_invocation_test(llm_config, &tool, &prompt).await
}

/// Layer 4 多模型对比测试
#[tauri::command]
async fn test_comparison(
    llm_configs: Vec<LlmConfig>,
    tool: ToolInfo,
    prompt: String,
) -> Result<ComparisonResult, String> {
    run_comparison(llm_configs, &tool, &prompt).await
}

// =========================================================================
// MITM 代理命令
// =========================================================================

/// 启动 stdio MITM 代理
#[tauri::command]
async fn start_stdio_proxy(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    config: ServerConfig,
) -> Result<ProxyInfo, String> {
    state.stdio_proxy.start_proxy(&config, app).await
}

/// 停止 stdio MITM 代理
#[tauri::command]
async fn stop_stdio_proxy(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.stdio_proxy.stop_proxy(&id).await
}

/// 列出所有 stdio 代理
#[tauri::command]
async fn list_stdio_proxies(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProxyInfo>, String> {
    Ok(state.stdio_proxy.list_proxies().await)
}

/// 启动 HTTP MITM 代理
#[tauri::command]
async fn start_http_proxy(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    upstream_url: String,
    headers: std::collections::HashMap<String, String>,
) -> Result<HttpProxyInfo, String> {
    state.http_proxy.start_proxy(upstream_url, headers, app).await
}

/// 停止 HTTP MITM 代理
#[tauri::command]
async fn stop_http_proxy(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.http_proxy.stop_proxy(&id).await
}

/// 列出所有 HTTP 代理
#[tauri::command]
async fn list_http_proxies(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<HttpProxyInfo>, String> {
    Ok(state.http_proxy.list_proxies().await)
}

/// 协议合规性检查
#[tauri::command]
async fn run_spec_check(
    state: tauri::State<'_, AppState>,
    server_id: String,
    server_name: String,
) -> Result<SpecReport, String> {
    let (capabilities, server_info) = state.mcp.get_server_meta(&server_id).await?;
    let mcp = &state.mcp;

    // 手动执行各检查项（不使用闭包，避免 lifetime 问题）
    let mut checks = Vec::new();

    // 1. 初始化握手
    checks.push(diag::spec_validator::check_initialize(&server_info, &capabilities));

    // 2. Capabilities 协商
    checks.extend(diag::spec_validator::check_capabilities(&capabilities));

    // 3-5. tools/resources/prompts list
    for method in ["tools/list", "resources/list", "prompts/list"] {
        match mcp.raw_request(&server_id, method, serde_json::json!({})).await {
            Ok(resp) => {
                let check = match method {
                    "tools/list" => diag::spec_validator::check_tools_list(&resp),
                    "resources/list" => diag::spec_validator::check_resources_list(&resp),
                    "prompts/list" => diag::spec_validator::check_prompts_list(&resp),
                    _ => continue,
                };
                checks.push(check);
            }
            Err(e) => {
                checks.push(diag::spec_validator::make_request_fail_check(method, &e));
            }
        }
    }

    // 6. 错误处理 — 未知方法
    match mcp.raw_request(&server_id, "nonexistent/method", serde_json::json!({})).await {
        Ok(resp) => checks.push(diag::spec_validator::check_error_handling(&resp)),
        Err(_) => {}
    }

    // 统计
    let passed = checks.iter().filter(|c| c.status == diag::spec_validator::SpecStatus::Pass).count();
    let warnings = checks.iter().filter(|c| c.status == diag::spec_validator::SpecStatus::Warning).count();
    let failed = checks.iter().filter(|c| c.status == diag::spec_validator::SpecStatus::Fail).count();

    Ok(SpecReport {
        server_id,
        server_name,
        passed,
        warnings,
        failed,
        checks,
        spec_version: "2025-06-18".to_string(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    })
}

// =========================================================================
// Phase 6: 高级功能
// =========================================================================

/// Description 优化
#[tauri::command]
async fn optimize_tool_description(
    llm_config: LlmConfig,
    tool: ToolInfo,
) -> Result<DescriptionOptimization, String> {
    diag::optimizer::optimize_description(
        &llm_config,
        &tool.name,
        &tool.description,
        &tool.input_schema,
    )
    .await
}

/// 批量 Lint 所有工具
#[tauri::command]
async fn batch_lint_tools(
    state: tauri::State<'_, AppState>,
    server_id: String,
) -> Result<BatchLintResult, String> {
    let tools = state.mcp.list_tools(&server_id).await?;
    Ok(diag::optimizer::batch_lint(&tools))
}

// --- 会话录制 ---

/// 开始录制
#[tauri::command]
async fn start_recording(
    state: tauri::State<'_, AppState>,
    server_id: String,
    server_name: String,
) -> Result<String, String> {
    state.recording.start(&server_id, &server_name).await
}

/// 停止录制
#[tauri::command]
async fn stop_recording(
    state: tauri::State<'_, AppState>,
) -> Result<SessionRecording, String> {
    state.recording.stop().await
}

/// 获取录制状态
#[tauri::command]
async fn get_recording_status(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state.recording.is_recording().await)
}

/// 列出所有录制
#[tauri::command]
async fn list_recordings(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<SessionRecording>, String> {
    Ok(state.recording.list().await)
}

/// 获取单个录制详情
#[tauri::command]
async fn get_recording(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Option<SessionRecording>, String> {
    Ok(state.recording.get(&id).await)
}

/// 删除录制
#[tauri::command]
async fn delete_recording(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    state.recording.delete(&id).await
}

/// 导出录制为 JSON
#[tauri::command]
async fn export_recording(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    state.recording.export(&id).await
}

/// 导入录制
#[tauri::command]
async fn import_recording(
    state: tauri::State<'_, AppState>,
    json: String,
) -> Result<SessionRecording, String> {
    state.recording.import(&json).await
}

/// 回放录制
#[tauri::command]
async fn replay_recording(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<RecordedMessage>, String> {
    state.recording.replay(&id).await
}

// =========================================================================
// 应用入口
// =========================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            mcp: McpClientManager::new(),
            stdio_proxy: ProxyManager::new(),
            http_proxy: HttpProxyManager::new(),
            recording: RecordingManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            // MCP 客户端
            mcp::client::connect_server,
            mcp::client::disconnect_server,
            mcp::client::list_tools,
            mcp::client::call_tool,
            mcp::client::list_resources,
            mcp::client::read_resource,
            mcp::client::list_prompts,
            mcp::client::get_prompt,
            // 诊断
            lint_tool,
            test_invocation,
            test_comparison,
            // stdio MITM 代理
            start_stdio_proxy,
            stop_stdio_proxy,
            list_stdio_proxies,
            // HTTP MITM 代理
            start_http_proxy,
            stop_http_proxy,
            list_http_proxies,
            // 协议合规性检查
            run_spec_check,
            // Phase 6: 高级功能
            optimize_tool_description,
            batch_lint_tools,
            start_recording,
            stop_recording,
            get_recording_status,
            list_recordings,
            get_recording,
            delete_recording,
            export_recording,
            import_recording,
            replay_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
