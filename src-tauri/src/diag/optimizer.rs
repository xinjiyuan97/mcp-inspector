//! Description 优化器
//!
//! 利用 LLM 自动分析和优化 MCP Tool 的 description。
//! 输入：工具名称、当前 description、inputSchema
//! 输出：优化后的 description + 优化理由 + 改进点列表

use serde::{Deserialize, Serialize};
use crate::diag::llm_adapter::{LlmAdapter, OpenAiAdapter, AnthropicAdapter, LlmConfig, ApiFormat, ToolDefinition};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DescriptionOptimization {
    /// 原始 description
    pub original: String,
    /// 优化后的 description
    pub optimized: String,
    /// 优化理由
    pub rationale: String,
    /// 改进点列表
    pub improvements: Vec<String>,
    /// 优化质量评分 (0-100)
    pub quality_score: u32,
}

const SYSTEM_PROMPT: &str = r#"你是一个 MCP (Model Context Protocol) 工具描述优化专家。

MCP 工具的 description 会被 LLM 读取来决定是否调用该工具。好的 description 应该：
1. 清晰说明工具的功能和用途
2. 说明输入参数的含义和格式
3. 说明返回值的结构和内容
4. 包含使用示例（如果参数复杂）
5. 避免模糊、过于简短或过于冗长

请分析给定的工具描述，并提供优化版本。返回 JSON 格式：
{
  "optimized": "优化后的描述",
  "rationale": "优化理由",
  "improvements": ["改进点1", "改进点2", ...],
  "quality_score": 85
}

quality_score 是原始描述的质量评分 (0-100)。
"#;

pub async fn optimize_description(
    config: &LlmConfig,
    tool_name: &str,
    original_desc: &str,
    input_schema: &serde_json::Value,
) -> Result<DescriptionOptimization, String> {
    let user_content = format!(
        r#"工具名称: {tool_name}

当前描述:
{original_desc}

输入参数 Schema:
{schema}

请分析并优化此工具描述。"#,
        schema = serde_json::to_string_pretty(input_schema).unwrap_or_default()
    );

    let adapter: Box<dyn LlmAdapter> = match config.api_format {
        ApiFormat::Anthropic => Box::new(AnthropicAdapter::new(config.clone())),
        ApiFormat::OpenAi => Box::new(OpenAiAdapter::new(config.clone())),
    };

    // 利用 chat_with_tools 发送一个 prompt（不带工具定义，纯文本对话）
    let response = adapter.chat_with_tools(&user_content, &[]).await?;

    // 解析 LLM 返回的 JSON
    let parsed: DescriptionOptimization = parse_llm_json(&response.content, original_desc)?;

    Ok(parsed)
}

/// 从 LLM 响应中提取 JSON（处理 markdown code fence 包裹的情况）
fn parse_llm_json(response: &str, original: &str) -> Result<DescriptionOptimization, String> {
    // 去掉 markdown code fence
    let json_str = response
        .trim()
        .strip_prefix("```json")
        .or_else(|| response.trim().strip_prefix("```"))
        .map(|s| s.trim_end_matches("```").trim())
        .unwrap_or(response.trim());

    match serde_json::from_str::<DescriptionOptimization>(json_str) {
        Ok(mut result) => {
            if result.original.is_empty() {
                result.original = original.to_string();
            }
            Ok(result)
        }
        Err(e) => {
            // 尝试提取 JSON 部分
            if let Some(start) = response.find('{') {
                if let Some(end) = response.rfind('}') {
                    if let Ok(mut result) = serde_json::from_str::<DescriptionOptimization>(&response[start..=end]) {
                        if result.original.is_empty() {
                            result.original = original.to_string();
                        }
                        return Ok(result);
                    }
                }
            }
            Err(format!("LLM 返回解析失败: {e}\n原始响应: {response}"))
        }
    }
}

/// 批量 Lint 所有工具
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchLintResult {
    pub results: Vec<(String, crate::diag::linter::LintReport)>,
    pub total: usize,
    pub passed: usize,
    pub warnings: usize,
    pub failed: usize,
}

pub fn batch_lint(tools: &[crate::mcp::types::ToolInfo]) -> BatchLintResult {
    let mut results = Vec::new();
    let mut passed = 0;
    let mut warnings = 0;
    let mut failed = 0;

    for tool in tools {
        let report = crate::diag::linter::lint(tool);
        let has_error = report.checks.iter().any(|c| matches!(c.severity, crate::diag::linter::LintSeverity::Error));
        let has_warning = report.checks.iter().any(|c| matches!(c.severity, crate::diag::linter::LintSeverity::Warn));

        if has_error {
            failed += 1;
        } else if has_warning {
            warnings += 1;
        } else {
            passed += 1;
        }

        results.push((tool.name.clone(), report));
    }

    BatchLintResult {
        total: tools.len(),
        passed,
        warnings,
        failed,
        results,
    }
}
