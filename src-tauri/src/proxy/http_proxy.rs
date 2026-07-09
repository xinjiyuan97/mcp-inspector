//! HTTP MITM 代理
//!
//! 工作原理：
//! 1. MCP 工坊启动本地 HTTP server（如 127.0.0.1:9090）
//! 2. 用户把 Claude Desktop / Cursor 的 MCP server URL 指向本地代理
//! 3. 代理转发请求到真正的 HTTP MCP server
//! 4. 拦截+记录所有 JSON-RPC 请求和响应

use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::super::mcp::types::{MessageDirection, MessageLog};

/// HTTP 代理信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpProxyInfo {
    pub id: String,
    /// 代理监听地址（用户配置这个）
    pub proxy_url: String,
    /// 上游真实 MCP server URL
    pub upstream_url: String,
}

/// HTTP 代理会话
pub struct HttpProxySession {
    pub id: String,
    pub proxy_url: String,
    pub upstream_url: String,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

/// HTTP 代理管理器
pub struct HttpProxyManager {
    sessions: Arc<Mutex<std::collections::HashMap<String, HttpProxySession>>>,
}

impl HttpProxyManager {
    pub fn new() -> Self {
        HttpProxyManager {
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// 启动 HTTP 代理
    pub async fn start_proxy(
        &self,
        upstream_url: String,
        headers: std::collections::HashMap<String, String>,
        app: AppHandle,
    ) -> Result<HttpProxyInfo, String> {
        use axum::{routing::post, Router, body::Body, extract::Request, response::Response};
        use hyper::StatusCode;

        // 绑定随机端口
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("HTTP 代理 bind 失败: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("获取端口失败: {e}"))?
            .port();
        let proxy_url = format!("http://127.0.0.1:{port}");

        let session_id = Uuid::new_v4().to_string();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

        // 创建 HTTP client 转发请求
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("创建 HTTP client 失败: {e}"))?;

        let upstream = upstream_url.clone();
        let hdrs = headers.clone();
        let sid = session_id.clone();
        let app_clone = app.clone();

        // axum handler — 转发请求并记录
        let handler = move |req: Request<Body>| {
            let client = client.clone();
            let upstream = upstream.clone();
            let hdrs = hdrs.clone();
            let sid = sid.clone();
            let app = app_clone.clone();

            async move {
                // 读取请求体
                let req_body = axum::body::to_bytes(req.into_body(), 1024 * 1024 * 10)
                    .await
                    .map_err(|e| format!("读取请求体失败: {e}"));

                let req_bytes = match req_body {
                    Ok(b) => b,
                    Err(e) => {
                        return Response::builder()
                            .status(StatusCode::BAD_REQUEST)
                            .body(Body::from(e))
                            .unwrap();
                    }
                };

                // 记录请求
                log_http_jsonrpc(&req_bytes, true, &app, &sid);

                // 转发到上游
                let mut req_builder = client.post(&upstream);
                for (k, v) in &hdrs {
                    req_builder = req_builder.header(k, v);
                }
                req_builder = req_builder.header("Content-Type", "application/json");

                let upstream_resp = match req_builder.body(req_bytes).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        return Response::builder()
                            .status(StatusCode::BAD_GATEWAY)
                            .body(Body::from(format!("上游连接失败: {e}")))
                            .unwrap();
                    }
                };

                let status = upstream_resp.status();
                let resp_body = upstream_resp.bytes().await.unwrap_or_default();

                // 记录响应
                log_http_jsonrpc(&resp_body, false, &app, &sid);

                Response::builder()
                    .status(status)
                    .header("Content-Type", "application/json")
                    .body(Body::from(resp_body))
                    .unwrap()
            }
        };

        let app_router = Router::new().fallback(post(handler));

        let sid_for_shutdown = session_id.clone();
        tokio::spawn(async move {
            axum::serve(listener, app_router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        let info = HttpProxyInfo {
            id: session_id.clone(),
            proxy_url: proxy_url.clone(),
            upstream_url: upstream_url.clone(),
        };

        self.sessions.lock().await.insert(
            session_id,
            HttpProxySession {
                id: sid_for_shutdown,
                proxy_url,
                upstream_url,
                shutdown_tx: Some(shutdown_tx),
            },
        );

        Ok(info)
    }

    pub async fn stop_proxy(&self, id: &str) -> Result<(), String> {
        let mut session = self.sessions.lock().await.remove(id);
        if let Some(ref mut s) = session {
            if let Some(tx) = s.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
        Ok(())
    }

    pub async fn list_proxies(&self) -> Vec<HttpProxyInfo> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .map(|s| HttpProxyInfo {
                id: s.id.clone(),
                proxy_url: s.proxy_url.clone(),
                upstream_url: s.upstream_url.clone(),
            })
            .collect()
    }

    pub async fn stop_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (_, mut s) in sessions.drain() {
            if let Some(tx) = s.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
    }
}

/// 记录 HTTP JSON-RPC 消息
fn log_http_jsonrpc(data: &[u8], is_request: bool, app: &AppHandle, session_id: &str) {
    let text = match std::str::from_utf8(data) {
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

    let direction = if is_request {
        if json.get("method").is_some() && json.get("id").is_none() {
            MessageDirection::Notification
        } else {
            MessageDirection::Request
        }
    } else if json.get("result").is_some() || json.get("error").is_some() {
        MessageDirection::Response
    } else {
        MessageDirection::Response
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
