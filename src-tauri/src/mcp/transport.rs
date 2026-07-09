//! 传输层封装 — stdio / HTTP transport builders for rmcp clients.
//!
//! 本模块把 `ServerConfig` 转换成 rmcp 的 `RunningService`，并一并管理为
//! transport 提供底层 IO 的资源（例如子进程句柄），以便在断开连接时清理。
//!
//! 设计说明：
//! - 项目仅启用了 rmcp 的 `transport-io`（=> `transport-async-rw`）与
//!   `transport-streamable-http-client-reqwest` feature，未启用
//!   `transport-child-process`，因此 `TokioChildProcess` 不可用。这里通过
//!   `AsyncRwTransport` 直接包装子进程的 stdout/stdin，达到等价效果，并自行
//!   管理子进程的生命周期。
//! - HTTP transport 直接使用 rmcp 提供的 `StreamableHttpClientTransport`（reqwest 后端）。
//! - `().serve(transport)` 在 stdio 与 http 两种 transport 上都返回同一个具体类型
//!   `RunningService<RoleClient, ()>`，因此两个分支可以返回统一的结果类型。

use std::process::Stdio;

use rmcp::transport::async_rw::AsyncRwTransport;
use rmcp::{model::ServerInfo, RoleClient, ServiceExt};
use tokio::process::{Child, Command};

use super::types::{ServerConfig, TransportType};

/// transport 建立后的结果：一个正在运行的 client service + 需要保活的底层资源。
pub struct EstablishedTransport {
    /// 已完成 initialize 握手的 client service（Deref 到 `Peer<RoleClient>`）。
    pub service: rmcp::service::RunningService<RoleClient, ()>,
    /// stdio 模式下的子进程句柄（disconnect 时 kill）；http 模式为 None。
    pub child: Option<Child>,
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

    let mut cmd = Command::new(&command);
    cmd.args(&config.args);
    cmd.envs(config.env.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::inherit());
    // 让子进程进入新的会话/进程组，避免主进程信号影响它。
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                // 尽力创建新会话；失败可忽略。
                extern "C" {
                    fn setsid() -> i32;
                }
                let _ = setsid();
                Ok(())
            });
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn stdio command '{command}': {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture child stdout".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture child stdin".to_string())?;

    let transport = AsyncRwTransport::<RoleClient, _, _>::new_client(stdout, stdin);

    // `().serve(transport)` 会完成 MCP initialize 握手并返回 RunningService。
    let service = ()
        .serve(transport)
        .await
        .map_err(|e| format!("stdio client initialize failed: {e}"))?;

    let server_info = service.peer_info().cloned();

    Ok(EstablishedTransport {
        service,
        child: Some(child),
        server_info,
    })
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

    let service = ()
        .serve(transport)
        .await
        .map_err(|e| format!("http client initialize failed: {e}"))?;

    let server_info = service.peer_info().cloned();

    Ok(EstablishedTransport {
        service,
        child: None,
        server_info,
    })
}
