//! LLM 适配层 — 统一 trait，支持 OpenAI 兼容 / Anthropic 两种 API 格式。
//!
//! 国内模型（DeepSeek/Qwen/GLM/Kimi 等）大多兼容 OpenAI function calling 格式，
//! 因此 OpenAI 适配器是主力，Anthropic 仅用于 Claude 原生 API。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// LLM 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    /// 显示名（如 "GPT-4o", "DeepSeek-V3"）
    pub name: String,
    /// API 格式
    pub api_format: ApiFormat,
    /// API base URL（如 "https://api.openai.com/v1"）
    pub base_url: String,
    /// API key
    pub api_key: String,
    /// 模型名（如 "gpt-4o", "deepseek-chat"）
    pub model: String,
    /// 采样温度（默认 0.7）
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    OpenAi,
    Anthropic,
}

/// LLM 调用结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    /// 模型返回的文本内容
    pub content: String,
    /// 模型是否发起了 tool_call
    pub tool_call: Option<ToolCallInfo>,
    /// 模型耗时（毫秒）
    pub latency_ms: u64,
    /// token 用量
    pub usage: Option<TokenUsage>,
    /// 原始响应（调试用）
    pub raw: serde_json::Value,
}

/// tool_call 详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallInfo {
    /// 模型调用的工具名
    pub name: String,
    /// 模型传入的参数（JSON）
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// LLM 适配器 trait
#[async_trait]
pub trait LlmAdapter: Send + Sync {
    async fn chat_with_tools(
        &self,
        prompt: &str,
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse, String>;
}

/// 传给 LLM 的工具定义
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

// =========================================================================
// OpenAI 兼容适配器
// =========================================================================

pub struct OpenAiAdapter {
    client: reqwest::Client,
    config: LlmConfig,
}

impl OpenAiAdapter {
    pub fn new(config: LlmConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        Self { client, config }
    }
}

#[async_trait]
impl LlmAdapter for OpenAiAdapter {
    async fn chat_with_tools(
        &self,
        prompt: &str,
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse, String> {
        let url = format!("{}/chat/completions", self.config.base_url.trim_end_matches('/'));
        let tools_json: Vec<serde_json::Value> = tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect();

        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "tools": tools_json,
            "tool_choice": "auto",
            "temperature": self.config.temperature.unwrap_or(0.7),
        });

        let start = std::time::Instant::now();
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求 LLM 失败: {e}"))?;

        let status = resp.status();
        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析 LLM 响应失败 (status {status}): {e}"))?;

        if !status.is_success() {
            let err_msg = raw["error"]["message"]
                .as_str()
                .unwrap_or("未知错误");
            return Err(format!("LLM 返回错误 ({}): {}", status, err_msg));
        }

        let latency_ms = start.elapsed().as_millis() as u64;

        // 解析 tool_calls
        let choice = &raw["choices"][0]["message"];
        let content = choice["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let tool_call = choice["tool_calls"]
            .as_array()
            .and_then(|arr| arr.first())
            .map(|tc| {
                let name = tc["function"]["name"]
                    .as_str()
                    .unwrap_or("")
                    .to_string();
                let args_str = tc["function"]["arguments"]
                    .as_str()
                    .unwrap_or("{}");
                let arguments = serde_json::from_str(args_str)
                    .unwrap_or(serde_json::Value::Null);
                ToolCallInfo { name, arguments }
            });

        let usage = raw["usage"].as_object().map(|u| TokenUsage {
            prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
            completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
            total_tokens: u["total_tokens"].as_u64().unwrap_or(0),
        });

        Ok(LlmResponse {
            content,
            tool_call,
            latency_ms,
            usage,
            raw: raw.clone(),
        })
    }
}

// =========================================================================
// Anthropic 适配器
// =========================================================================

pub struct AnthropicAdapter {
    client: reqwest::Client,
    config: LlmConfig,
}

impl AnthropicAdapter {
    pub fn new(config: LlmConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        Self { client, config }
    }
}

#[async_trait]
impl LlmAdapter for AnthropicAdapter {
    async fn chat_with_tools(
        &self,
        prompt: &str,
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse, String> {
        let url = format!("{}/messages", self.config.base_url.trim_end_matches('/'));
        let tools_json: Vec<serde_json::Value> = tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect();

        let body = serde_json::json!({
            "model": self.config.model,
            "max_tokens": 4096,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "tools": tools_json,
        });

        let start = std::time::Instant::now();
        let resp = self
            .client
            .post(&url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("请求 Anthropic 失败: {e}"))?;

        let status = resp.status();
        let raw: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("解析 Anthropic 响应失败 (status {status}): {e}"))?;

        if !status.is_success() {
            let err_msg = raw["error"]["message"]
                .as_str()
                .unwrap_or("未知错误");
            return Err(format!("Anthropic 返回错误 ({}): {}", status, err_msg));
        }

        let latency_ms = start.elapsed().as_millis() as u64;

        // 解析 content blocks
        let mut content = String::new();
        let mut tool_call = None;

        if let Some(blocks) = raw["content"].as_array() {
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = block["text"].as_str() {
                            content.push_str(t);
                        }
                    }
                    Some("tool_use") => {
                        let name = block["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_string();
                        let arguments = block["input"]
                            .clone();
                        tool_call = Some(ToolCallInfo { name, arguments });
                    }
                    _ => {}
                }
            }
        }

        let usage = raw["usage"].as_object().map(|u| TokenUsage {
            prompt_tokens: u["input_tokens"].as_u64().unwrap_or(0),
            completion_tokens: u["output_tokens"].as_u64().unwrap_or(0),
            total_tokens: u["input_tokens"].as_u64().unwrap_or(0)
                + u["output_tokens"].as_u64().unwrap_or(0),
        });

        Ok(LlmResponse {
            content,
            tool_call,
            latency_ms,
            usage,
            raw: raw.clone(),
        })
    }
}

// =========================================================================
// 工厂函数
// =========================================================================

/// 根据 config 创建适配器
pub fn create_adapter(config: LlmConfig) -> Box<dyn LlmAdapter> {
    match config.api_format {
        ApiFormat::OpenAi => Box::new(OpenAiAdapter::new(config)),
        ApiFormat::Anthropic => Box::new(AnthropicAdapter::new(config)),
    }
}
