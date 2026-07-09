use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// MCP 服务器配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub transport: TransportType,
    // stdio transport
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    // http transport
    pub url: Option<String>,
    pub headers: HashMap<String, String>,
    // 通用
    pub timeout: u64,
}

/// 传输类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransportType {
    Stdio,
    Http,
}

/// 工具信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// 资源信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

/// Prompt 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptInfo {
    pub name: String,
    pub description: String,
    pub arguments: Vec<PromptArgument>,
}

/// Prompt 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptArgument {
    pub name: String,
    pub description: Option<String>,
    pub required: bool,
}

/// 消息方向
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    Request,
    Response,
    Notification,
    Error,
}

/// JSON-RPC 消息日志
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageLog {
    pub id: String,
    pub timestamp: DateTime<Utc>,
    pub direction: MessageDirection,
    pub method: Option<String>,
    pub payload: serde_json::Value,
    pub duration_ms: Option<u64>,
}

/// 服务器连接状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected,
    Error(String),
}

/// 服务器连接信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConnection {
    pub config: ServerConfig,
    pub status: ConnectionStatus,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub capabilities: Option<serde_json::Value>,
}
