use serde::{Deserialize, Serialize};
use super::super::mcp::types::ToolInfo;

/// 诊断报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LintReport {
    pub tool_name: String,
    pub checks: Vec<LintCheck>,
    pub overall_status: LintStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LintStatus {
    Pass,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LintCheck {
    pub rule: String,
    pub severity: LintSeverity,
    pub message: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LintSeverity {
    Error,
    Warn,
    Info,
}

/// 对 tool schema 做静态检查
pub fn lint(tool: &ToolInfo) -> LintReport {
    let mut checks = Vec::new();

    // 1. name 格式
    check_name_format(&tool.name, &mut checks);

    // 2. description 长度
    check_description_length(&tool.description, &mut checks);

    // 3. description 质量
    check_description_quality(&tool.description, &mut checks);

    // 4. schema 格式
    check_schema_format(&tool.input_schema, &mut checks);

    // 5. 参数检查
    check_params(&tool.input_schema, &mut checks);

    // 计算总体状态
    let has_error = checks.iter().any(|c| matches!(c.severity, LintSeverity::Error));
    let has_warn = checks.iter().any(|c| matches!(c.severity, LintSeverity::Warn));

    let overall_status = if has_error {
        LintStatus::Error
    } else if has_warn {
        LintStatus::Warning
    } else {
        LintStatus::Pass
    };

    LintReport {
        tool_name: tool.name.clone(),
        checks,
        overall_status,
    }
}

fn check_name_format(name: &str, checks: &mut Vec<LintCheck>) {
    // 检查长度
    if name.len() > 64 {
        checks.push(LintCheck {
            rule: "name_length".into(),
            severity: LintSeverity::Warn,
            message: format!("工具名长度 {} 超过 64 字符", name.len()),
            suggestion: Some("缩短工具名，模型对短名识别更准确".into()),
        });
    }

    // 检查格式：小写+下划线/连字符
    if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-') {
        checks.push(LintCheck {
            rule: "name_format".into(),
            severity: LintSeverity::Warn,
            message: format!("工具名 '{}' 包含非标准字符（建议小写+下划线）", name),
            suggestion: Some("使用小写字母、数字和下划线，如 read_file".into()),
        });
    }

    // 检查是否太短
    if name.len() < 3 {
        checks.push(LintCheck {
            rule: "name_too_short".into(),
            severity: LintSeverity::Warn,
            message: format!("工具名 '{}' 太短", name),
            suggestion: Some("工具名应能清晰表达功能，至少 3 个字符".into()),
        });
    }
}

fn check_description_length(desc: &str, checks: &mut Vec<LintCheck>) {
    let len = desc.len();
    if len == 0 {
        checks.push(LintCheck {
            rule: "description_missing".into(),
            severity: LintSeverity::Error,
            message: "工具缺少 description".into(),
            suggestion: Some("description 是模型选择工具的关键依据，必须提供".into()),
        });
    } else if len < 10 {
        checks.push(LintCheck {
            rule: "description_too_short".into(),
            severity: LintSeverity::Warn,
            message: format!("description 太短（{} 字符），模型可能无法准确理解工具用途", len),
            suggestion: Some("补充工具的功能说明、使用场景和返回值".into()),
        });
    } else if len > 500 {
        checks.push(LintCheck {
            rule: "description_too_long".into(),
            severity: LintSeverity::Info,
            message: format!("description 较长（{} 字符），可能影响模型处理效率", len),
            suggestion: Some("如非必要，精简到 200 字符以内".into()),
        });
    }
}

fn check_description_quality(desc: &str, checks: &mut Vec<LintCheck>) {
    if desc.is_empty() {
        return;
    }

    // 检查占位符
    if desc.contains("TODO") || desc.contains("FIXME") || desc.contains("XXX") {
        checks.push(LintCheck {
            rule: "description_placeholder".into(),
            severity: LintSeverity::Warn,
            message: "description 包含占位符标记（TODO/FIXME）".into(),
            suggestion: Some("完成 description 编写，移除占位符".into()),
        });
    }

    // 检查是否是单个单词（太简略）
    if desc.split_whitespace().count() == 1 {
        checks.push(LintCheck {
            rule: "description_too_simple".into(),
            severity: LintSeverity::Warn,
            message: format!("description 只有一个单词 '{}'，信息量不足", desc),
            suggestion: Some("补充动词+对象+条件，如 'Read the contents of a file at the given path'".into()),
        });
    }

    // 检查是否包含返回值说明
    if !desc.contains("return") && !desc.contains("返回") && !desc.contains("Returns") {
        checks.push(LintCheck {
            rule: "description_no_return_info".into(),
            severity: LintSeverity::Info,
            message: "description 未说明返回值".into(),
            suggestion: Some("补充返回值类型和格式说明，帮助模型判断工具适用性".into()),
        });
    }
}

fn check_schema_format(schema: &serde_json::Value, checks: &mut Vec<LintCheck>) {
    // schema 应该是 object 类型
    if let Some(obj) = schema.as_object() {
        // type 应该是 "object"
        match obj.get("type") {
            None => {
                checks.push(LintCheck {
                    rule: "schema_type_missing".into(),
                    severity: LintSeverity::Warn,
                    message: "inputSchema 缺少 type 字段".into(),
                    suggestion: Some("MCP 工具的 inputSchema 应声明 type: \"object\"".into()),
                });
            }
            Some(t) if t.as_str() == Some("object") => {}
            Some(t) => {
                checks.push(LintCheck {
                    rule: "schema_type_not_object".into(),
                    severity: LintSeverity::Error,
                    message: format!("inputSchema type 应为 \"object\"，实际为 {:?}", t),
                    suggestion: Some("MCP 工具参数必须是 object 类型".into()),
                });
            }
        }

        // properties 应该存在
        if !obj.contains_key("properties") {
            checks.push(LintCheck {
                rule: "schema_no_properties".into(),
                severity: LintSeverity::Warn,
                message: "inputSchema 没有 properties 字段".into(),
                suggestion: Some("即使无参数，也应声明 properties: {}".into()),
            });
        }
    } else {
        checks.push(LintCheck {
            rule: "schema_not_object".into(),
            severity: LintSeverity::Error,
            message: "inputSchema 不是 JSON 对象".into(),
            suggestion: Some("inputSchema 必须是 JSON Schema 对象".into()),
        });
    }
}

fn check_params(schema: &serde_json::Value, checks: &mut Vec<LintCheck>) {
    let obj = match schema.as_object() {
        Some(o) => o,
        None => return,
    };

    let properties = match obj.get("properties").and_then(|p| p.as_object()) {
        Some(p) => p,
        None => return,
    };

    let required: Vec<&str> = obj
        .get("required")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    // 参数数量检查
    if properties.len() > 8 {
        checks.push(LintCheck {
            rule: "param_count".into(),
            severity: LintSeverity::Warn,
            message: format!("参数数量较多（{} 个），模型可能难以正确填充", properties.len()),
            suggestion: Some("参数超过 8 个时，考虑拆分工具或减少非必要参数".into()),
        });
    }

    // required 与 properties 一致性
    for req in &required {
        if !properties.contains_key(*req) {
            checks.push(LintCheck {
                rule: "required_consistency".into(),
                severity: LintSeverity::Error,
                message: format!("required 字段 '{}' 未在 properties 中定义", req),
                suggestion: Some(format!("在 properties 中添加 '{}' 的定义，或从 required 中移除", req)),
            });
        }
    }

    // 每个参数的检查
    for (param_name, param_schema) in properties {
        check_single_param(param_name, param_schema, &required, checks);
    }

    // 嵌套深度
    let max_depth = calculate_depth(schema, 0);
    if max_depth > 3 {
        checks.push(LintCheck {
            rule: "nesting_depth".into(),
            severity: LintSeverity::Warn,
            message: format!("schema 嵌套深度为 {}，模型容易搞混", max_depth),
            suggestion: Some("object 嵌套不超过 3 层，考虑扁平化参数".into()),
        });
    }
}

fn check_single_param(name: &str, schema: &serde_json::Value, required: &[&str], checks: &mut Vec<LintCheck>) {
    let obj = match schema.as_object() {
        Some(o) => o,
        None => {
            checks.push(LintCheck {
                rule: "param_not_object".into(),
                severity: LintSeverity::Error,
                message: format!("参数 '{}' 的 schema 不是对象", name),
                suggestion: None,
            });
            return;
        }
    };

    // type 检查
    if let Some(t) = obj.get("type") {
        let valid_types = ["string", "number", "integer", "boolean", "object", "array", "null"];
        if let Some(t_str) = t.as_str() {
            if !valid_types.contains(&t_str) {
                checks.push(LintCheck {
                    rule: "param_type_invalid".into(),
                    severity: LintSeverity::Error,
                    message: format!("参数 '{}' type '{}' 不是合法 JSON Schema 类型", name, t_str),
                    suggestion: Some("合法类型: string, number, integer, boolean, object, array, null".into()),
                });
            }
        }
    }

    // description 检查
    let has_desc = obj.contains_key("description");
    if !has_desc {
        checks.push(LintCheck {
            rule: "param_description_missing".into(),
            severity: LintSeverity::Warn,
            message: format!("参数 '{}' 缺少 description", name),
            suggestion: Some("为每个参数添加 description，模型靠它理解参数含义".into()),
        });
    }

    // enum 缺失检查（如果参数名暗示有限取值）
    let name_lower = name.to_lowercase();
    let enum_hint_words = ["mode", "type", "format", "action", "method", "level", "status", "sort"];
    if enum_hint_words.iter().any(|w| name_lower.contains(w)) && !obj.contains_key("enum") {
        checks.push(LintCheck {
            rule: "enum_missing".into(),
            severity: LintSeverity::Info,
            message: format!("参数 '{}' 可能是有限取值，但未声明 enum", name),
            suggestion: Some(format!("如果 '{}' 只有几个可选值，添加 enum 约束可以减少模型猜测", name)),
        });
    }

    // 非必填参数缺 default
    let is_required = required.iter().any(|r| *r == name);
    if !is_required && !obj.contains_key("default") {
        checks.push(LintCheck {
            rule: "default_missing".into(),
            severity: LintSeverity::Info,
            message: format!("非必填参数 '{}' 没有 default 值", name),
            suggestion: Some("为可选参数提供 default 值可以减少模型出错".into()),
        });
    }
}

fn calculate_depth(value: &serde_json::Value, current: usize) -> usize {
    match value {
        serde_json::Value::Object(obj) => {
            let max_child = obj
                .values()
                .map(|v| calculate_depth(v, current + 1))
                .max()
                .unwrap_or(current);
            max_child
        }
        serde_json::Value::Array(arr) => {
            let max_child = arr
                .iter()
                .map(|v| calculate_depth(v, current + 1))
                .max()
                .unwrap_or(current);
            max_child
        }
        _ => current,
    }
}
