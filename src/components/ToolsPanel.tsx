import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import { useLlmStore } from "../store/llmStore";
import JsonViewer from "./JsonViewer";
import ToolForm, {
  buildInitialValues,
  parseFormArgs,
  validateForm,
} from "./ToolForm";
import { Play, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { clsx } from "clsx";
import type { ToolInfo } from "../types";

export default function ToolsPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;

  if (!server) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
        <Wrench size={32} className="opacity-20" />
        <span className="text-sm">请选择左侧服务器</span>
      </div>
    );
  }

  if (server.status === "connecting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
        <Wrench size={32} className="opacity-20" />
        <span className="text-sm">连接中...</span>
      </div>
    );
  }

  if (server.tools.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-500">
        <Wrench size={32} className="opacity-20" />
        <span className="text-sm">
          {server.status === "connected" ? "正在加载工具..." : "暂无工具"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
      {server.tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} serverId={activeServerId!} />
      ))}
    </div>
  );
}

function ToolCard({ tool, serverId }: { tool: ToolInfo; serverId: string }) {
  const [expanded, setExpanded] = useState(false);
  const defaultModel = useLlmStore((s) => s.getDefaultToolModel());
  const initialValues = useMemo(
    () => buildInitialValues(tool.input_schema, defaultModel ? { model: defaultModel } : undefined),
    [tool.input_schema, defaultModel],
  );
  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);

  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCall = async () => {
    const validationError = validateForm(formValues, tool.input_schema);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const parsedArgs = parseFormArgs(formValues, tool.input_schema);
      const res = await invoke("call_tool", {
        serverId,
        toolName: tool.name,
        args: parsedArgs,
      });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-neutral-700 rounded-lg overflow-hidden min-w-0">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-800"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-mono text-sm font-medium text-blue-400">{tool.name}</span>
        <span className="text-xs text-neutral-500 truncate flex-1">{tool.description}</span>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-neutral-700 px-3 pb-3 pt-3 min-w-0">
          <ToolForm schema={tool.input_schema} values={formValues} onChange={setFormValues} />

          <button
            onClick={handleCall}
            disabled={loading}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-sm",
              "bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
            )}
          >
            <Play size={12} />
            {loading ? "调用中..." : "调用"}
          </button>

          {result && (
            <div>
              <div className="text-xs text-green-400 mb-1">结果</div>
              <JsonViewer value={result} maxHeight="300px" />
            </div>
          )}

          {error && (
            <div className="p-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
