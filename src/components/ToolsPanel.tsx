import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import JsonViewer from "./JsonViewer";
import { Play, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { clsx } from "clsx";
import type { ToolInfo } from "../types";

export default function ToolsPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;

  if (!server || server.tools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
        <Wrench size={32} className="opacity-20" />
        <span className="text-sm">暂无工具</span>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-3 space-y-2">
      {server.tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} serverId={activeServerId!} />
      ))}
    </div>
  );
}

function ToolCard({ tool, serverId }: { tool: ToolInfo; serverId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [args, setArgs] = useState<string>("{}");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCall = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const parsedArgs = JSON.parse(args);
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
    <div className="border border-neutral-700 rounded-lg overflow-hidden">
      {/* 头部 */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-800"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-mono text-sm font-medium text-blue-400">{tool.name}</span>
        <span className="text-xs text-neutral-500 truncate flex-1">{tool.description}</span>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-neutral-700 pt-2">
          {/* Input Schema */}
          <div>
            <div className="text-xs text-neutral-500 mb-1">Input Schema</div>
            <JsonViewer value={tool.input_schema} maxHeight="200px" />
          </div>

          {/* 参数输入 */}
          <div>
            <div className="text-xs text-neutral-500 mb-1">参数 (JSON)</div>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="w-full h-20 px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
              placeholder="{}"
            />
          </div>

          {/* 调用按钮 */}
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

          {/* 结果 */}
          {result && (
            <div>
              <div className="text-xs text-green-400 mb-1">结果</div>
              <JsonViewer value={result} maxHeight="300px" />
            </div>
          )}

          {/* 错误 */}
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
