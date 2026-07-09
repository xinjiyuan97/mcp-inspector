import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import JsonViewer from "./JsonViewer";
import {
  Stethoscope, AlertTriangle, CheckCircle, XCircle, Info, Loader2,
  Play, Users, Plus, Settings, ChevronDown, ChevronRight,
  Hash, ShieldCheck,
} from "lucide-react";
import { clsx } from "clsx";
import type {
  ToolInfo, LlmConfig, LintReport, InvocationResult, ComparisonResult,
  SpecReport,
} from "../types";

// 预设 LLM 配置
const LLM_PRESETS: LlmConfig[] = [
  { name: "GPT-4o", api_format: "open_ai", base_url: "https://api.openai.com/v1", api_key: "", model: "gpt-4o", temperature: 0.7 },
  { name: "DeepSeek-V3", api_format: "open_ai", base_url: "https://api.deepseek.com", api_key: "", model: "deepseek-chat", temperature: 0.7 },
  { name: "Qwen-Max", api_format: "open_ai", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", api_key: "", model: "qwen-max", temperature: 0.7 },
  { name: "GLM-4-Plus", api_format: "open_ai", base_url: "https://open.bigmodel.cn/api/paas/v4", api_key: "", model: "glm-4-plus", temperature: 0.7 },
  { name: "Claude-3.5-Sonnet", api_format: "anthropic", base_url: "https://api.anthropic.com/v1", api_key: "", model: "claude-3-5-sonnet-20241022", temperature: 0.7 },
  { name: "Kimi-K2", api_format: "open_ai", base_url: "https://api.moonshot.cn/v1", api_key: "", model: "moonshot-v1-auto", temperature: 0.7 },
];

type Tab = "lint" | "invoke" | "compare" | "spec";

export default function DiagnosticPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;
  const [tab, setTab] = useState<Tab>("lint");
  const [selectedTool, setSelectedTool] = useState<string | null>(null);

  if (!server || server.tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Stethoscope size={32} className="opacity-20" />
        <span className="text-sm">暂无可诊断的工具</span>
      </div>
    );
  }

  const tools = server.tools;
  const tool = selectedTool ? tools.find((t) => t.name === selectedTool) : null;

  return (
    <div className="flex flex-col h-full">
      {/* 工具选择 */}
      <div className="p-3 border-b border-neutral-700">
        <div className="text-xs text-neutral-500 mb-2">选择工具进行诊断</div>
        <div className="flex flex-wrap gap-2">
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => setSelectedTool(t.name)}
              className={clsx(
                "px-2 py-1 rounded text-xs font-mono",
                selectedTool === t.name
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-700 hover:bg-neutral-600 text-neutral-300"
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 p-2 border-b border-neutral-700">
        <TabButton active={tab === "lint"} onClick={() => setTab("lint")} icon={<Stethoscope size={14} />}>
          Layer 1: 静态分析
        </TabButton>
        <TabButton active={tab === "invoke"} onClick={() => setTab("invoke")} icon={<Play size={14} />}>
          Layer 3: 调用测试
        </TabButton>
        <TabButton active={tab === "compare"} onClick={() => setTab("compare")} icon={<Users size={14} />}>
          Layer 4: 多模型对比
        </TabButton>
        <TabButton active={tab === "spec"} onClick={() => setTab("spec")} icon={<ShieldCheck size={14} />}>
          协议合规
        </TabButton>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === "spec" ? (
          <SpecValidatorView />
        ) : tool ? (
          <>
            {tab === "lint" && <LintView tool={tool} />}
            {tab === "invoke" && <InvokeView tool={tool} />}
            {tab === "compare" && <CompareView tool={tool} />}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
            <Stethoscope size={32} className="opacity-20" />
            <span className="text-sm">点击上方工具名开始诊断</span>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium",
        active ? "bg-blue-600 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// =========================================================================
// Layer 1: 静态分析
// =========================================================================

function LintView({ tool }: { tool: ToolInfo }) {
  const [report, setReport] = useState<LintReport | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLint = async () => {
    setLoading(true);
    setReport(null);
    try {
      const res = await invoke<LintReport>("lint_tool", { tool });
      setReport(res);
    } catch (e) {
      setReport({
        tool_name: tool.name,
        checks: [{ rule: "runtime", severity: "error", message: String(e) }],
        overall_status: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={handleLint}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Stethoscope size={16} />}
        {loading ? "分析中..." : "运行静态分析"}
      </button>

      {report && (
        <>
          {/* 总结 */}
          <div
            className={clsx(
              "flex items-center gap-2 px-3 py-2 rounded-lg",
              report.overall_status === "pass" && "bg-green-900/30 border border-green-700",
              report.overall_status === "warning" && "bg-yellow-900/30 border border-yellow-700",
              report.overall_status === "error" && "bg-red-900/30 border border-red-700"
            )}
          >
            {report.overall_status === "pass" && <CheckCircle size={18} className="text-green-400" />}
            {report.overall_status === "warning" && <AlertTriangle size={18} className="text-yellow-400" />}
            {report.overall_status === "error" && <XCircle size={18} className="text-red-400" />}
            <span className="text-sm font-medium">
              {report.overall_status === "pass" && "通过 — 未发现问题"}
              {report.overall_status === "warning" && "有警告 — 建议优化"}
              {report.overall_status === "error" && "有错误 — 需要修复"}
            </span>
          </div>

          {/* 检查项 */}
          <div className="space-y-1">
            {report.checks.map((check, i) => (
              <div
                key={i}
                className={clsx(
                  "flex items-start gap-2 px-3 py-2 rounded",
                  check.severity === "error" && "bg-red-900/20",
                  check.severity === "warn" && "bg-yellow-900/20",
                  check.severity === "info" && "bg-blue-900/20"
                )}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {check.severity === "error" && <XCircle size={14} className="text-red-400" />}
                  {check.severity === "warn" && <AlertTriangle size={14} className="text-yellow-400" />}
                  {check.severity === "info" && <Info size={14} className="text-blue-400" />}
                </div>
                <div className="flex-1">
                  <span className="text-xs font-mono text-neutral-400">{check.rule}</span>
                  <div className="text-sm text-neutral-200">{check.message}</div>
                  {check.suggestion && (
                    <div className="text-xs text-green-400 mt-1">💡 {check.suggestion}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Schema */}
          <div>
            <div className="text-xs text-neutral-500 mb-1">Tool Schema</div>
            <JsonViewer value={tool.input_schema} maxHeight="200px" />
          </div>
        </>
      )}
    </div>
  );
}

// =========================================================================
// Layer 3: 调用测试
// =========================================================================

function InvokeView({ tool }: { tool: ToolInfo }) {
  const [llmConfigs, setLlmConfigs] = useState<LlmConfig[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [prompt, setPrompt] = useState(`请使用 ${tool.name} 工具来完成相关任务`);
  const [result, setResult] = useState<InvocationResult | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedConfig = llmConfigs.find((c) => c.api_key);

  const handleTest = async () => {
    if (!selectedConfig) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await invoke<InvocationResult>("test_invocation", {
        llmConfig: selectedConfig,
        tool,
        prompt,
      });
      setResult(res);
    } catch (e) {
      setResult({
        llm_name: selectedConfig.name,
        prompt,
        invoked: false, correct_tool: false, correct_args: false,
        arg_issues: [], content: "",
        latency_ms: 0,
        conclusion: `❌ 调用失败: ${e}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* LLM 配置区 */}
      <div className="border border-neutral-700 rounded-lg">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="flex items-center justify-between w-full px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          <span className="flex items-center gap-2">
            <Settings size={14} />
            LLM 配置 ({llmConfigs.filter(c => c.api_key).length}/{llmConfigs.length} 已就绪)
          </span>
          {showConfig ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {showConfig && (
          <div className="p-3 border-t border-neutral-700 space-y-2">
            {LLM_PRESETS.map((preset) => {
              const existing = llmConfigs.find((c) => c.name === preset.name);
              return (
                <div key={preset.name} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (existing) {
                        setLlmConfigs(llmConfigs.filter((c) => c.name !== preset.name));
                      } else {
                        setLlmConfigs([...llmConfigs, { ...preset }]);
                      }
                    }}
                    className={clsx(
                      "px-2 py-1 rounded text-xs",
                      existing ? "bg-green-700 text-white" : "bg-neutral-700 text-neutral-400"
                    )}
                  >
                    {existing ? "✓" : "+"} {preset.name}
                  </button>
                  {existing && (
                    <input
                      type="password"
                      placeholder="API Key"
                      value={existing.api_key}
                      onChange={(e) => {
                        setLlmConfigs(llmConfigs.map((c) =>
                          c.name === existing.name ? { ...c, api_key: e.target.value } : c
                        ));
                      }}
                      className="flex-1 px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-xs text-white"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prompt 输入 */}
      <div>
        <div className="text-xs text-neutral-500 mb-1">测试 Prompt</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white resize-none"
          placeholder="输入测试 prompt，让模型决定是否调用此工具..."
        />
      </div>

      {/* 执行按钮 */}
      <button
        onClick={handleTest}
        disabled={loading || !selectedConfig}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
        {loading ? "测试中..." : `用 ${selectedConfig?.name || "—"} 测试`}
      </button>

      {/* 结果 */}
      {result && <InvocationResultView result={result} />}
    </div>
  );
}

function InvocationResultView({ result }: { result: InvocationResult }) {
  return (
    <div className="space-y-2">
      {/* 结论 */}
      <div className={clsx(
        "px-3 py-2 rounded-lg text-sm",
        result.invoked && result.correct_tool && result.correct_args && "bg-green-900/30 border border-green-700",
        (!result.invoked || (!result.correct_tool && result.invoked) || (result.correct_tool && !result.correct_args)) && "bg-yellow-900/30 border border-yellow-700",
        !result.invoked && "bg-red-900/30 border border-red-700",
      )}>
        {result.conclusion}
      </div>

      {/* 指标 */}
      <div className="grid grid-cols-4 gap-2">
        <Metric label="调用" value={result.invoked ? "✓" : "✗"} ok={result.invoked} />
        <Metric label="工具名" value={result.correct_tool ? "✓" : "✗"} ok={result.correct_tool} />
        <Metric label="参数" value={result.correct_args ? "✓" : "✗"} ok={result.correct_args} />
        <Metric label="耗时" value={`${(result.latency_ms / 1000).toFixed(1)}s`} ok={result.latency_ms < 10000} />
      </div>

      {/* 参数问题 */}
      {result.arg_issues.length > 0 && (
        <div className="px-3 py-2 bg-yellow-900/20 rounded text-sm">
          <div className="text-xs text-yellow-400 mb-1">参数问题:</div>
          {result.arg_issues.map((issue, i) => (
            <div key={i} className="text-neutral-300 text-xs">• {issue}</div>
          ))}
        </div>
      )}

      {/* tool_call 详情 */}
      {result.tool_call_name && (
        <div className="px-3 py-2 bg-neutral-800 rounded">
          <div className="text-xs text-neutral-400 mb-1">Tool Call: <span className="text-blue-400 font-mono">{result.tool_call_name}</span></div>
          {result.tool_call_args && (
            <JsonViewer value={result.tool_call_args} maxHeight="150px" />
          )}
        </div>
      )}

      {/* 模型文本回复 */}
      {result.content && (
        <div className="px-3 py-2 bg-neutral-800 rounded">
          <div className="text-xs text-neutral-400 mb-1">模型回复:</div>
          <div className="text-sm text-neutral-200">{result.content}</div>
        </div>
      )}

      {/* Token 用量 */}
      {result.total_tokens && (
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <Hash size={12} />
          {result.total_tokens} tokens
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="px-2 py-1.5 bg-neutral-800 rounded text-center">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={clsx("text-sm font-bold", ok ? "text-green-400" : "text-red-400")}>{value}</div>
    </div>
  );
}

// =========================================================================
// Layer 4: 多模型对比
// =========================================================================

function CompareView({ tool }: { tool: ToolInfo }) {
  const [llmConfigs, setLlmConfigs] = useState<LlmConfig[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [prompt, setPrompt] = useState(`请使用 ${tool.name} 工具来完成相关任务`);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);

  const readyConfigs = llmConfigs.filter((c) => c.api_key);

  const handleCompare = async () => {
    if (readyConfigs.length < 2) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await invoke<ComparisonResult>("test_comparison", {
        llmConfigs: readyConfigs,
        tool,
        prompt,
      });
      setResult(res);
    } catch (e) {
      setResult({
        tool_name: tool.name,
        prompt,
        results: [],
        analysis: { all_invoked: false, all_correct_tool: false, all_correct_args: false, invoked_count: 0, correct_tool_count: 0, correct_args_count: 0, conclusion: `❌ 对比失败: ${e}` },
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* LLM 选择 */}
      <div className="border border-neutral-700 rounded-lg">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="flex items-center justify-between w-full px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          <span className="flex items-center gap-2">
            <Users size={14} />
            选择对比模型 ({readyConfigs.length} 已就绪)
          </span>
          {showConfig ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {showConfig && (
          <div className="p-3 border-t border-neutral-700 grid grid-cols-2 gap-2">
            {LLM_PRESETS.map((preset) => {
              const existing = llmConfigs.find((c) => c.name === preset.name);
              return (
                <div key={preset.name} className="flex flex-col gap-1">
                  <button
                    onClick={() => {
                      if (existing) {
                        setLlmConfigs(llmConfigs.filter((c) => c.name !== preset.name));
                      } else {
                        setLlmConfigs([...llmConfigs, { ...preset }]);
                      }
                    }}
                    className={clsx(
                      "flex items-center gap-2 px-2 py-1 rounded text-xs text-left",
                      existing ? "bg-green-700/50 text-green-300" : "bg-neutral-700 text-neutral-400"
                    )}
                  >
                    {existing ? <CheckCircle size={12} /> : <Plus size={12} />}
                    {preset.name}
                  </button>
                  {existing && (
                    <input
                      type="password"
                      placeholder="API Key"
                      value={existing.api_key}
                      onChange={(e) => {
                        setLlmConfigs(llmConfigs.map((c) =>
                          c.name === existing.name ? { ...c, api_key: e.target.value } : c
                        ));
                      }}
                      className="px-2 py-0.5 bg-neutral-900 border border-neutral-700 rounded text-xs text-white"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white resize-none"
      />

      <button
        onClick={handleCompare}
        disabled={loading || readyConfigs.length < 2}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white text-sm font-medium"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
        {loading ? "对比中..." : `并行测试 ${readyConfigs.length} 个模型`}
      </button>

      {/* 结果 */}
      {result && (
        <div className="space-y-3">
          {/* 总体分析 */}
          <div className="px-3 py-2 bg-neutral-800 rounded-lg text-sm text-neutral-200">
            {result.analysis.conclusion}
          </div>

          {/* 对比表格 */}
          {result.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 text-neutral-400 text-xs">
                    <th className="text-left px-2 py-1">模型</th>
                    <th className="text-center px-2 py-1">调用</th>
                    <th className="text-center px-2 py-1">工具名</th>
                    <th className="text-center px-2 py-1">参数</th>
                    <th className="text-right px-2 py-1">耗时</th>
                    <th className="text-right px-2 py-1">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-800">
                      <td className="px-2 py-1.5 text-neutral-200 font-medium">{r.llm_name}</td>
                      <td className="text-center px-2 py-1.5">{r.invoked ? "✅" : "❌"}</td>
                      <td className="text-center px-2 py-1.5">{r.correct_tool ? "✅" : "❌"}</td>
                      <td className="text-center px-2 py-1.5">{r.correct_args ? "✅" : "⚠️"}</td>
                      <td className="text-right px-2 py-1.5 text-neutral-400">{(r.latency_ms / 1000).toFixed(1)}s</td>
                      <td className="text-right px-2 py-1.5 text-neutral-500">{r.total_tokens ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 每个模型的详细结论 */}
          <div className="space-y-1">
            {result.results.map((r, i) => (
              <div key={i} className="px-3 py-1.5 bg-neutral-800/50 rounded text-xs">
                <span className="text-neutral-400 font-medium">{r.llm_name}:</span>{" "}
                <span className="text-neutral-300">{r.conclusion}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 协议合规性检查
// =========================================================================

function SpecValidatorView() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;
  const [report, setReport] = useState<SpecReport | null>(null);
  const [loading, setLoading] = useState(false);

  if (!server) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <ShieldCheck size={32} className="opacity-20" />
        <span className="text-sm">请先连接 MCP 服务器</span>
      </div>
    );
  }

  const handleRun = async () => {
    setLoading(true);
    try {
      const result = await invoke<SpecReport>("run_spec_check", {
        serverId: server.config.id,
        serverName: server.config.name,
      });
      setReport(result);
    } catch (e) {
      alert(`合规性检查失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pass": return <CheckCircle size={14} className="text-green-400" />;
      case "warning": return <AlertTriangle size={14} className="text-yellow-400" />;
      case "fail": return <XCircle size={14} className="text-red-400" />;
      case "not_applicable": return <Info size={14} className="text-neutral-500" />;
      default: return null;
    }
  };

  const categoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      initialize: "初始化",
      capabilities: "能力协商",
      tools: "工具",
      resources: "资源",
      prompts: "Prompt",
      error_handling: "错误处理",
      notifications: "通知",
    };
    return map[cat] || cat;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white text-sm font-medium"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
          运行合规性检查
        </button>
        <span className="text-xs text-neutral-500">
          基于 MCP 2025-06-18 规范
        </span>
      </div>

      {report && (
        <>
          {/* 汇总 */}
          <div className="flex gap-4 p-3 bg-neutral-800 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-400" />
              <span className="text-sm text-neutral-300">通过 {report.passed}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-yellow-400" />
              <span className="text-sm text-neutral-300">警告 {report.warnings}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle size={16} className="text-red-400" />
              <span className="text-sm text-neutral-300">失败 {report.failed}</span>
            </div>
            <div className="ml-auto text-xs text-neutral-500">
              {report.spec_version}
            </div>
          </div>

          {/* 检查项列表 */}
          <div className="space-y-1">
            {report.checks.map((check) => (
              <div key={check.id} className="p-3 bg-neutral-800/50 rounded-lg">
                <div className="flex items-center gap-2">
                  {statusIcon(check.status)}
                  <span className="text-sm font-medium text-neutral-200">{check.name}</span>
                  <span className="px-1.5 py-0.5 rounded bg-neutral-700 text-xs text-neutral-400">
                    {categoryLabel(check.category)}
                  </span>
                  {check.spec_reference && (
                    <span className="ml-auto text-xs text-neutral-600">{check.spec_reference}</span>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-1 ml-6">{check.description}</p>
                {check.detail && (
                  <p className="text-xs text-neutral-400 mt-1 ml-6 font-mono">{check.detail}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
