//! Layer 3 调用测试 + Layer 4 多模型对比
//!
//! 把 tool 定义 + 测试 prompt 发给 LLM，检查：
//! - 是否发起 tool_call
//! - 工具名是否正确
//! - 参数是否匹配 inputSchema
//! 然后给出诊断结论。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use super::llm_adapter::{
    create_adapter, ApiFormat, LlmConfig, LlmResponse, ToolDefinition,
};
use super::super::mcp::types::ToolInfo;

// =========================================================================
// Layer 3: 单模型调用测试
// =========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvocationResult {
    /// 被测试的 LLM 名称
    pub llm_name: String,
    /// 测试 prompt
    pub prompt: String,
    /// 模型是否发起了 tool_call
    pub invoked: bool,
    /// 调用的工具名是否正确
    pub correct_tool: bool,
    /// 参数是否匹配 schema
    pub correct_args: bool,
    /// 参数问题详情
    pub arg_issues: Vec<String>,
    /// 模型返回的文本
    pub content: String,
    /// tool_call 详情
    pub tool_call_name: Option<String>,
    pub tool_call_args: Option<serde_json::Value>,
    /// 耗时
    pub latency_ms: u64,
    /// token 用量
    pub total_tokens: Option<u64>,
    /// 诊断结论
    pub conclusion: String,
}

/// 执行单次调用测试
pub async fn run_invocation_test(
    llm_config: LlmConfig,
    tool: &ToolInfo,
    prompt: &str,
) -> Result<InvocationResult, String> {
    let adapter = create_adapter(llm_config.clone());
    let tool_def = ToolDefinition {
        name: tool.name.clone(),
        description: tool.description.clone(),
        input_schema: tool.input_schema.clone(),
    };

    let response: LlmResponse = adapter
        .chat_with_tools(prompt, &[tool_def])
        .await
        .map_err(|e| format!("LLM 调用失败: {e}"))?;

    // 分析结果
    let invoked = response.tool_call.is_some();
    let (correct_tool, correct_args, arg_issues, tool_call_name, tool_call_args) =
        match &response.tool_call {
            Some(tc) => {
                let ct = tc.name == tool.name;
                let (ca, issues) = validate_arguments(&tc.arguments, &tool.input_schema);
                (
                    ct,
                    ca,
                    issues,
                    Some(tc.name.clone()),
                    Some(tc.arguments.clone()),
                )
            }
            None => (false, false, vec![], None, None),
        };

    // 生成诊断结论
    let conclusion = generate_conclusion(invoked, correct_tool, correct_args, &arg_issues);

    Ok(InvocationResult {
        llm_name: llm_config.name,
        prompt: prompt.to_string(),
        invoked,
        correct_tool,
        correct_args,
        arg_issues,
        content: response.content,
        tool_call_name,
        tool_call_args,
        latency_ms: response.latency_ms,
        total_tokens: response.usage.as_ref().map(|u| u.total_tokens),
        conclusion,
    })
}

// =========================================================================
// Layer 4: 多模型对比
// =========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub tool_name: String,
    pub prompt: String,
    pub results: Vec<InvocationResult>,
    /// 横向分析
    pub analysis: ComparisonAnalysis,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonAnalysis {
    /// 所有模型都调用了工具
    pub all_invoked: bool,
    /// 所有模型都选对了工具
    pub all_correct_tool: bool,
    /// 所有模型参数都正确
    pub all_correct_args: bool,
    /// 调用了工具的模型数
    pub invoked_count: usize,
    /// 选对工具的模型数
    pub correct_tool_count: usize,
    /// 参数正确的模型数
    pub correct_args_count: usize,
    /// 诊断结论
    pub conclusion: String,
}

/// 并行多模型对比测试
pub async fn run_comparison(
    llm_configs: Vec<LlmConfig>,
    tool: &ToolInfo,
    prompt: &str,
) -> Result<ComparisonResult, String> {
    let mut handles = Vec::new();

    for config in llm_configs {
        let tool = tool.clone();
        let prompt = prompt.to_string();
        handles.push(tokio::spawn(async move {
            run_invocation_test(config, &tool, &prompt).await
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(r)) => results.push(r),
            Ok(Err(e)) => results.push(InvocationResult {
                llm_name: "unknown".to_string(),
                prompt: prompt.to_string(),
                invoked: false,
                correct_tool: false,
                correct_args: false,
                arg_issues: vec![],
                content: String::new(),
                tool_call_name: None,
                tool_call_args: None,
                latency_ms: 0,
                total_tokens: None,
                conclusion: format!("测试失败: {e}"),
            }),
            Err(e) => results.push(InvocationResult {
                llm_name: "unknown".to_string(),
                prompt: prompt.to_string(),
                invoked: false,
                correct_tool: false,
                correct_args: false,
                arg_issues: vec![],
                content: String::new(),
                tool_call_name: None,
                tool_call_args: None,
                latency_ms: 0,
                total_tokens: None,
                conclusion: format!("内部错误: {e}"),
            }),
        }
    }

    let analysis = analyze_results(&results);

    Ok(ComparisonResult {
        tool_name: tool.name.clone(),
        prompt: prompt.to_string(),
        results,
        analysis,
    })
}

// =========================================================================
// 内部工具函数
// =========================================================================

/// 验证 LLM 返回的参数是否匹配 tool schema
fn validate_arguments(
    args: &serde_json::Value,
    schema: &serde_json::Value,
) -> (bool, Vec<String>) {
    let mut issues = Vec::new();

    let schema_obj = match schema.as_object() {
        Some(o) => o,
        None => return (true, issues), // 无 schema 约束则跳过
    };

    let properties = schema_obj
        .get("properties")
        .and_then(|p| p.as_object());

    let required: Vec<&str> = schema_obj
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let args_obj = match args.as_object() {
        Some(o) => o,
        None => {
            if required.is_empty() {
                return (true, issues);
            }
            issues.push(format!("参数不是 JSON 对象，但 schema 有 {} 个 required 字段", required.len()));
            return (false, issues);
        }
    };

    // 检查 required 字段是否都存在
    for req in &required {
        if !args_obj.contains_key(*req) {
            issues.push(format!("缺少必填参数: {}", req));
        }
    }

    // 检查每个参数的类型
    if let Some(props) = properties {
        for (name, value) in args_obj {
            if let Some(param_schema) = props.get(name) {
                if let Some(expected_type) = param_schema.get("type").and_then(|t| t.as_str()) {
                    let type_ok = match expected_type {
                        "string" => value.is_string(),
                        "number" | "integer" => value.is_number(),
                        "boolean" => value.is_boolean(),
                        "object" => value.is_object(),
                        "array" => value.is_array(),
                        "null" => value.is_null(),
                        _ => true,
                    };
                    if !type_ok {
                        issues.push(format!(
                            "参数 '{}' 类型错误: 期望 {}, 实际 {}",
                            name,
                            expected_type,
                            json_type_name(value)
                        ));
                    }
                }

                // enum 检查
                if let Some(enum_vals) = param_schema.get("enum").and_then(|e| e.as_array()) {
                    if !enum_vals.contains(value) {
                        issues.push(format!(
                            "参数 '{}' 值 {:?} 不在 enum 范围内: {:?}",
                            name, value, enum_vals
                        ));
                    }
                }
            } else {
                issues.push(format!("参数 '{}' 未在 schema properties 中定义", name));
            }
        }
    }

    let ok = issues.is_empty();
    (ok, issues)
}

fn json_type_name(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// 生成单次调用测试的诊断结论
fn generate_conclusion(
    invoked: bool,
    correct_tool: bool,
    correct_args: bool,
    arg_issues: &[String],
) -> String {
    if !invoked {
        return "❌ 模型未调用工具。可能原因：(1) description 不够清晰，模型不确定工具用途；(2) prompt 与工具功能不匹配；(3) 模型能力不足。建议优化 description 或尝试更强的模型。".to_string();
    }

    if !correct_tool {
        return "⚠️ 模型调用了错误的工具。可能原因：多个工具的 description 存在歧义，或 description 未突出本工具的核心功能。".to_string();
    }

    if !correct_args {
        let issues_str = arg_issues.join("; ");
        return format!("⚠️ 模型调用了正确的工具，但参数有问题: {issues_str}。可能原因：参数 description 不清晰、schema 有歧义、或参数过多导致模型混乱。").to_string();
    }

    "✅ 模型成功调用了正确的工具并传入了正确的参数。".to_string()
}

/// 横向分析多模型结果
fn analyze_results(results: &[InvocationResult]) -> ComparisonAnalysis {
    let total = results.len();
    let invoked_count = results.iter().filter(|r| r.invoked).count();
    let correct_tool_count = results.iter().filter(|r| r.correct_tool).count();
    let correct_args_count = results.iter().filter(|r| r.correct_args).count();

    let all_invoked = invoked_count == total;
    let all_correct_tool = correct_tool_count == total;
    let all_correct_args = correct_args_count == total;

    let conclusion = if total == 0 {
        "无测试结果".to_string()
    } else if all_invoked && all_correct_tool && all_correct_args {
        "✅ 所有模型都成功调用。工具描述质量良好，适配多模型。".to_string()
    } else if !all_invoked {
        if invoked_count == 0 {
            "❌ 所有模型都未调用此工具。问题很可能在工具描述（description）—— 太短、太模糊、或与 prompt 不匹配。建议重写 description。".to_string()
        } else {
            format!("⚠️ {}/{} 个模型未调用此工具。部分模型可能能力不足，但也可能是 description 不够清晰导致弱模型无法理解。建议优化 description 以兼容更多模型。", total - invoked_count, total)
        }
    } else if !all_correct_tool {
        format!("⚠️ {}/{} 个模型调用了错误的工具名。可能是 description 存在歧义。", total - correct_tool_count, total)
    } else {
        format!("⚠️ {}/{} 个模型参数不正确。建议检查参数 description 和 schema 是否清晰。", total - correct_args_count, total)
    };

    ComparisonAnalysis {
        all_invoked,
        all_correct_tool,
        all_correct_args,
        invoked_count,
        correct_tool_count,
        correct_args_count,
        conclusion,
    }
}
