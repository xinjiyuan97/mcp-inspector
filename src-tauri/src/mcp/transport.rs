//! 传输层封装 — stdio / HTTP transport builders for rmcp clients.
//!
//! 本模块把 `ServerConfig` 转换成 rmcp 的 `RunningService`，并一并管理为
//! transport 提供底层 IO 的资源（例如子进程句柄），以便在断开连接时清理。
//!
//! 设计说明：
//! - stdio 使用 rmcp 的 `TokioChildProcess` 管理子进程生命周期。
//! - HTTP transport 直接使用 rmcp 提供的 `StreamableHttpClientTransport`（reqwest 后端）。

use std::path::{Path, PathBuf};
use std::time::Duration;

use rmcp::transport::TokioChildProcess;
use rmcp::{model::ServerInfo, RoleClient, ServiceExt};
use tokio::process::Command;

use super::types::{ServerConfig, TransportType};

/// 连接超时下限（秒），避免配置为 0 时立即超时。
const MIN_CONNECT_TIMEOUT_SECS: u64 = 5;

/// transport 建立后的结果：一个正在运行的 client service + 需要保活的底层资源。
pub struct EstablishedTransport {
    /// 已完成 initialize 握手的 client service（Deref 到 `Peer<RoleClient>`）。
    pub service: rmcp::service::RunningService<RoleClient, ()>,
    /// stdio 模式下的子进程句柄（disconnect 时 kill）；http 模式为 None。
    pub child: Option<tokio::process::Child>,
    /// 对端 server 信息（initialize 响应）。
    pub server_info: Option<ServerInfo>,
}

/// 根据 `ServerConfig.transport` 选择并建立 transport，完成 MCP initialize 握手。
pub async fn establish_transport(config: &ServerConfig) -> Result<EstablishedTransport, String> {
    match config.transport {
        TransportType::Stdio => establish_stdio(config).await,
        TransportType::Http => establish_http(config).await,
    }
}

// ---------------------------------------------------------------------------
// stdio
// ---------------------------------------------------------------------------

async fn establish_stdio(config: &ServerConfig) -> Result<EstablishedTransport, String> {
    let command = config
        .command
        .clone()
        .ok_or_else(|| "stdio transport requires `command` field".to_string())?;

    let resolved_command = resolve_executable(&command)
        .ok_or_else(|| format!("找不到可执行文件 '{command}'，请填写绝对路径（如 /opt/homebrew/bin/codex）"))?;

    tracing::info!(
        "spawning stdio mcp server: {} {:?}",
        resolved_command,
        config.args
    );

    let mut args = config.args.clone();
    if is_npx_command(&resolved_command) && !args.iter().any(|a| a == "-y" || a == "--yes") {
        // npx 在无 TTY 且 stdin 被 MCP 占用时会等待确认，导致永远“连接中”。
        args.insert(0, "-y".to_string());
    }

    let mut cmd = Command::new(&resolved_command);
    cmd.args(&args);
    cmd.envs(config.env.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    apply_runtime_env(&mut cmd, &config.env);

    let transport = TokioChildProcess::new(cmd).map_err(|e| {
        format!("failed to spawn stdio command '{resolved_command}': {e}")
    })?;

    let timeout_secs = config.timeout.max(MIN_CONNECT_TIMEOUT_SECS);
    let timeout = Duration::from_secs(timeout_secs);

    let service = match tokio::time::timeout(timeout, ().serve(transport)).await {
        Ok(Ok(service)) => service,
        Ok(Err(e)) => {
            return Err(format!("stdio client initialize failed: {e}"));
        }
        Err(_) => {
            return Err(format!(
                "连接超时（{timeout_secs} 秒）。请检查：命令是否正确、MCP 服务是否启动、Codex 是否已安装"
            ));
        }
    };

    let server_info = service.peer_info().cloned();
    tracing::info!("stdio mcp server connected: {}", config.name);

    Ok(EstablishedTransport {
        service,
        child: None,
        server_info,
    })
}

fn runtime_home() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    if let Ok(user) = std::env::var("USER") {
        let home = PathBuf::from(format!("/Users/{user}"));
        if home.is_dir() {
            return Some(home);
        }
    }
    None
}

/// 为 GUI 子进程补齐运行环境：PATH、HOME、工作目录。
fn apply_runtime_env(cmd: &mut Command, user_env: &std::collections::HashMap<String, String>) {
    let path_dirs = build_path_dirs();
    let current = std::env::var("PATH").unwrap_or_default();
    let merged = if current.is_empty() {
        path_dirs.join(":")
    } else {
        format!("{}:{}", path_dirs.join(":"), current)
    };
    cmd.env("PATH", merged);

    if !user_env.contains_key("HOME") {
        if let Some(home) = runtime_home() {
            cmd.env("HOME", home.to_string_lossy().as_ref());
            cmd.current_dir(&home);
        }
    }

    apply_noninteractive_env(cmd, user_env);
}

fn build_path_dirs() -> Vec<String> {
    let mut extra_paths = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        extra_paths.push(format!("{home}/.npm-global/bin"));
        extra_paths.push(format!("{home}/.local/bin"));
        extra_paths.push(format!("{home}/bin"));

        let nvm_root = format!("{home}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            for entry in entries.flatten() {
                extra_paths.push(format!("{}/bin", entry.path().display()));
            }
        }

        extra_paths.push(format!("{home}/.fnm/aliases/default/bin"));
    }

    extra_paths.push("/opt/homebrew/bin".to_string());
    extra_paths.push("/usr/local/bin".to_string());
    extra_paths
}

/// 在 PATH 中解析可执行文件，返回绝对路径。
fn resolve_executable(command: &str) -> Option<String> {
    let path = Path::new(command);
    if path.is_absolute() && path.exists() {
        return path
            .canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(|| Some(command.to_string()));
    }

    for dir in build_path_dirs() {
        let candidate = PathBuf::from(dir).join(command);
        if candidate.exists() {
            return candidate
                .canonicalize()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
                .or_else(|| Some(candidate.to_string_lossy().into_owned()));
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':').filter(|d| !d.is_empty()) {
            let candidate = PathBuf::from(dir).join(command);
            if candidate.exists() {
                return candidate
                    .canonicalize()
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
                    .or_else(|| Some(candidate.to_string_lossy().into_owned()));
            }
        }
    }

    None
}

/// 让 npm/npx 在非交互环境下不阻塞 stdin。
fn apply_noninteractive_env(cmd: &mut Command, user_env: &std::collections::HashMap<String, String>) {
    if !user_env.contains_key("CI") {
        cmd.env("CI", "true");
    }
    if !user_env.contains_key("NPM_CONFIG_YES") {
        cmd.env("NPM_CONFIG_YES", "true");
    }
    if !user_env.contains_key("NPX_YES") {
        cmd.env("NPX_YES", "true");
    }
}

fn is_npx_command(command: &str) -> bool {
    Path::new(command)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == "npx" || name == "npx.cmd")
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// HTTP (streamable http via reqwest)
// ---------------------------------------------------------------------------

async fn establish_http(config: &ServerConfig) -> Result<EstablishedTransport, String> {
    let url = config
        .url
        .clone()
        .ok_or_else(|| "http transport requires `url` field".to_string())?;

    // 解析 Authorization 头（如有）。
    let auth_header = config
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("authorization"))
        .map(|(_, v)| v.clone());

    let mut transport_config =
        rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(url);
    if let Some(auth) = auth_header {
        transport_config = transport_config.auth_header(auth);
    }

    let transport =
        rmcp::transport::StreamableHttpClientTransport::<reqwest::Client>::from_config(transport_config);

    let timeout_secs = config.timeout.max(MIN_CONNECT_TIMEOUT_SECS);
    let timeout = Duration::from_secs(timeout_secs);

    let service = match tokio::time::timeout(timeout, ().serve(transport)).await {
        Ok(Ok(service)) => service,
        Ok(Err(e)) => {
            return Err(format!(
                "http client initialize failed: {e}（请确认 URL 为 MCP Streamable HTTP 端点）"
            ));
        }
        Err(_) => {
            return Err(format!(
                "连接超时（{timeout_secs} 秒）。请检查 HTTP URL 是否正确、远端 MCP 服务是否已启动"
            ));
        }
    };

    let server_info = service.peer_info().cloned();

    Ok(EstablishedTransport {
        service,
        child: None,
        server_info,
    })
}
