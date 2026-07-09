//! 会话录制与回放
//!
//! 录制 MCP 工坊与 MCP server 之间的所有 JSON-RPC 通信，
//! 支持导出、回放、对比分析。

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

/// 单条录制的消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedMessage {
    pub id: String,
    /// 时间戳 (ISO 8601)
    pub timestamp: String,
    /// 方向: client_to_server | server_to_client
    pub direction: MessageDirection,
    /// JSON-RPC 消息内容
    pub content: serde_json::Value,
    /// 来源: direct | proxy
    pub source: MessageSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    ClientToServer,
    ServerToClient,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageSource {
    Direct,
    Proxy,
}

/// 一个完整的会话录制
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecording {
    pub id: String,
    pub name: String,
    pub server_id: String,
    pub server_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub messages: Vec<RecordedMessage>,
    /// 元数据
    pub metadata: HashMap<String, String>,
}

/// 会话录制管理器
pub struct RecordingManager {
    /// 当前正在录制的会话
    current: Arc<Mutex<Option<SessionRecording>>>,
    /// 已保存的录制
    recordings: Arc<Mutex<Vec<SessionRecording>>>,
}

impl RecordingManager {
    pub fn new() -> Self {
        Self {
            current: Arc::new(Mutex::new(None)),
            recordings: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// 开始录制
    pub async fn start(&self, server_id: &str, server_name: &str) -> Result<String, String> {
        let mut current = self.current.lock().await;
        if current.is_some() {
            return Err("已有正在进行的录制".to_string());
        }

        let id = Uuid::new_v4().to_string();
        let recording = SessionRecording {
            id: id.clone(),
            name: format!("录制 {}", Utc::now().format("%Y-%m-%d %H:%M:%S")),
            server_id: server_id.to_string(),
            server_name: server_name.to_string(),
            started_at: Utc::now().to_rfc3339(),
            ended_at: None,
            messages: Vec::new(),
            metadata: HashMap::new(),
        };

        *current = Some(recording);
        Ok(id)
    }

    /// 停止录制并保存
    pub async fn stop(&self) -> Result<SessionRecording, String> {
        let mut current = self.current.lock().await;
        let mut recording = current.take().ok_or("没有正在进行的录制")?;

        recording.ended_at = Some(Utc::now().to_rfc3339());

        let mut recordings = self.recordings.lock().await;
        recordings.push(recording.clone());

        Ok(recording)
    }

    /// 添加一条消息到当前录制
    pub async fn record_message(
        &self,
        direction: MessageDirection,
        content: serde_json::Value,
        source: MessageSource,
    ) -> Result<(), String> {
        let mut current = self.current.lock().await;
        if let Some(recording) = current.as_mut() {
            recording.messages.push(RecordedMessage {
                id: Uuid::new_v4().to_string(),
                timestamp: Utc::now().to_rfc3339(),
                direction,
                content,
                source,
            });
        }
        Ok(())
    }

    /// 获取当前录制状态
    pub async fn is_recording(&self) -> bool {
        self.current.lock().await.is_some()
    }

    /// 列出所有录制
    pub async fn list(&self) -> Vec<SessionRecording> {
        self.recordings.lock().await.clone()
    }

    /// 获取单个录制
    pub async fn get(&self, id: &str) -> Option<SessionRecording> {
        self.recordings.lock().await.iter().find(|r| r.id == id).cloned()
    }

    /// 删除录制
    pub async fn delete(&self, id: &str) -> Result<(), String> {
        let mut recordings = self.recordings.lock().await;
        recordings.retain(|r| r.id != id);
        Ok(())
    }

    /// 导出录制为 JSON 字符串
    pub async fn export(&self, id: &str) -> Result<String, String> {
        let recording = self.get(id).await.ok_or("录制不存在")?;
        serde_json::to_string_pretty(&recording).map_err(|e| e.to_string())
    }

    /// 导入录制
    pub async fn import(&self, json: &str) -> Result<SessionRecording, String> {
        let recording: SessionRecording = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let mut recordings = self.recordings.lock().await;
        recordings.push(recording.clone());
        Ok(recording)
    }

    /// 回放录制（返回消息序列供前端逐步展示）
    pub async fn replay(&self, id: &str) -> Result<Vec<RecordedMessage>, String> {
        let recording = self.get(id).await.ok_or("录制不存在")?;
        Ok(recording.messages)
    }
}

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}
