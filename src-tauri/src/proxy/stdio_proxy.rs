//! stdio MITM 代理
//!
//! 工作原理：
//! 1. MCP 工坊 spawn 真正的 MCP server（作为子进程）
//! 2. 启动 TCP listener（127.0.0.1:随机端口）
//! 3. 生成一行 Node.js 代理命令，用户配到 Claude Desktop
//! 4. 代理脚本连接 TCP，双向转发 stdin/stdout
//! 5. MCP 工坊在 TCP 层面做中间人：
//!    client → TCP → [MCP 工坊拦截记录] → upstream stdin
//!    upstream stdout → [MCP 工坊拦截记录] → TCP → client

use std::process::Stdio;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, oneshot};
use uuid::Uuid;

use super::super::mcp::types::{MessageDirection, MessageLog, ServerConfig};

/// 一个代理会话
pub struct ProxySession {
    pub id: String,
    pub port: u16,
    pub upstream_command: String,
    /// 用户配到 Claude Desktop 的 command
    pub proxy_command: String,
    /// 用户配到 Claude Desktop 的 args（JSON 字符串）
    pub proxy_args_json: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    child: Option<Child>,
}

/// 代理信息（返回给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyInfo {
    pub id: String,
    pub port: u16,
    pub upstream_command: String,
    pub proxy_command: String,
    pub proxy_args: Vec<String>,
    /// 用户需要配置的完整 JSON 片段
    pub claude_config_snippet: String,
}

impl ProxySession {
    /// 启动 stdio MITM 代理
    pub async fn start(config: &ServerConfig, app: AppHandle) -> Result<Self, String> {
        // 1. 绑定随机端口
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("TCP bind 失败: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("获取端口失败: {e}"))?
            .port();

        // 2. spawn 真正的 MCP server
        let command = config
            .command
            .clone()
            .ok_or("stdio transport 需要 command 字段")?;

        let mut cmd = Command::new(&command);
        cmd.args(&config.args);
        cmd.envs(config.env.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe {
                cmd.pre_exec(|| {
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
            .map_err(|e| format!("启动上游 MCP server 失败: {e}"))?;

        let child_stdin = child.stdin.take().ok_or("无法获取 upstream stdin")?;
        let child_stdout = child.stdout.take().ok_or("无法获取 upstream stdout")?;

        // 3. 启动 TCP 代理
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let session_id = Uuid::new_v4().to_string();

        let app_handle = app.clone();
        let sid = session_id.clone();

        tokio::spawn(async move {
            // 只接受一个连接（来自代理脚本）
            let (tcp_stream, _peer_addr) = match listener.accept().await {
                Ok(v) => v,
                Err(_) => return,
            };

            let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

            // client → upstream: tcp_read → child_stdin
            let app1 = app_handle.clone();
            let sid1 = sid.clone();
            let task_client_to_upstream = tokio::spawn(async move {
                let mut up_write = child_stdin;
                let mut buf = [0u8; 65536];
                let mut line_buf: Vec<u8> = Vec::new();

                loop {
                    match tcp_read.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            // 转发给 upstream
                            if up_write.write_all(&buf[..n]).await.is_err() {
                                break;
                            }
                            up_write.flush().await.ok();

                            // 解析 JSON-RPC 并记录
                            line_buf.extend_from_slice(&buf[..n]);
                            while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                                let line: Vec<u8> = line_buf.drain(..=pos).collect();
                                log_jsonrpc_message(&line, MessageDirection::Request, &app1, &sid1);
                            }
                        }
                    }
                }
            });

            // upstream → client: child_stdout → tcp_write
            let app2 = app_handle.clone();
            let sid2 = sid.clone();
            let task_upstream_to_client = tokio::spawn(async move {
                let mut up_read = child_stdout;
                let mut buf = [0u8; 65536];
                let mut line_buf: Vec<u8> = Vec::new();

                loop {
                    match up_read.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            // 转发给 client
                            if tcp_write.write_all(&buf[..n]).await.is_err() {
                                break;
                            }
                            tcp_write.flush().await.ok();

                            // 解析 JSON-RPC 并记录
                            line_buf.extend_from_slice(&buf[..n]);
                            while let Some(pos) = line_buf.iter().position(|&b| b == b'\n') {
                                let line: Vec<u8> = line_buf.drain(..=pos).collect();
                                // 判断方向：有 result/error 的是 Response，有 method 无 id 的是 Notification
                                log_jsonrpc_message(&line, MessageDirection::Response, &app2, &sid2);
                            }
                        }
                    }
                }
            });

            // 等待 shutdown 或任务结束
            let _ = shutdown_rx.await;
            task_client_to_upstream.abort();
            task_upstream_to_client.abort();
        });

        // 4. 生成代理命令
        let proxy_script = format!(
            r#"const net=require('net');const s=net.connect({port},'127.0.0.1');process.stdin.pipe(s);s.pipe(process.stdout);"#
        );
        let proxy_args = vec!["-e".to_string(), proxy_script];

        Ok(ProxySession {
            id: session_id,
            port,
            upstream_command: command,
            proxy_command: "node".to_string(),
            proxy_args_json: serde_json::to_string(&proxy_args).unwrap_or_default(),
            shutdown_tx: Some(shutdown_tx),
            child: Some(child),
        })
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
    }
}

impl ProxyInfo {
    pub fn from_session(session: &ProxySession) -> Self {
        let args: Vec<String> =
            serde_json::from_str(&session.proxy_args_json).unwrap_or_default();
        let snippet = format!(
            r#"{{"command":"{}","args":{}}}"#,
            session.proxy_command,
            serde_json::to_string(&args).unwrap_or_default()
        );
        ProxyInfo {
            id: session.id.clone(),
            port: session.port,
            upstream_command: session.upstream_command.clone(),
            proxy_command: session.proxy_command.clone(),
            proxy_args: args,
            claude_config_snippet: snippet,
        }
    }
}

/// 从一行文本中解析 JSON-RPC 消息并 emit 到前端
fn log_jsonrpc_message(line: &[u8], default_direction: MessageDirection, app: &AppHandle, session_id: &str) {
    let text = match std::str::from_utf8(line) {
        Ok(s) => s.trim(),
        Err(_) => return,
    };
    if text.is_empty() {
        return;
    }
    let json: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 智能判断方向
    let direction = if json.get("result").is_some() || json.get("error").is_some() {
        MessageDirection::Response
    } else if json.get("method").is_some() && json.get("id").is_none() {
        MessageDirection::Notification
    } else if json.get("method").is_some() {
        MessageDirection::Request
    } else {
        default_direction
    };

    let method = json["method"].as_str().map(String::from);

    let log = MessageLog {
        id: Uuid::new_v4().to_string(),
        timestamp: Utc::now(),
        direction,
        method,
        payload: json,
        duration_ms: None,
    };

    let _ = app.emit(&format!("proxy_message:{}", session_id), &log);
}

// =========================================================================
// 代理管理器
// =========================================================================

pub struct ProxyManager {
    sessions: Arc<Mutex<std::collections::HashMap<String, ProxySession>>>,
}

impl ProxyManager {
    pub fn new() -> Self {
        ProxyManager {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    pub async fn start_proxy(&self, config: &ServerConfig, app: AppHandle) -> Result<ProxyInfo, String> {
        let mut session = ProxySession::start(config, app).await?;
        let info = ProxyInfo::from_session(&session);
        let id = session.id.clone();
        self.sessions.lock().await.insert(id, session);
        Ok(info)
    }

    pub async fn stop_proxy(&self, id: &str) -> Result<(), String> {
        let mut session = self.sessions.lock().await.remove(id);
        if let Some(ref mut s) = session {
            s.stop().await;
        }
        Ok(())
    }

    pub async fn list_proxies(&self) -> Vec<ProxyInfo> {
        let sessions = self.sessions.lock().await;
        sessions.values().map(ProxyInfo::from_session).collect()
    }

    pub async fn stop_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (_, mut s) in sessions.drain() {
            s.stop().await;
        }
    }
}
