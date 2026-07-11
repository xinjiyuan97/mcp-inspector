import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import { MessageSquare, ChevronRight, Play } from "lucide-react";

export default function PromptsPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;

  if (!server || server.prompts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-neutral-500 gap-2">
        <MessageSquare size={32} className="opacity-20" />
        <span className="text-sm">暂无 Prompts</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
      {server.prompts.map((prompt) => (
        <PromptItem key={prompt.name} name={prompt.name} description={prompt.description} arguments_={prompt.arguments} serverId={activeServerId!} />
      ))}
    </div>
  );
}

function PromptItem({
  name,
  description,
  arguments_,
  serverId,
}: {
  name: string;
  description: string;
  arguments_: any[];
  serverId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGet = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<string>("get_prompt", { serverId, name, args: argValues });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-neutral-700 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-neutral-800"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight size={14} />
        <span className="font-mono text-sm text-blue-400">{name}</span>
        <span className="text-xs text-neutral-500 truncate flex-1">{description}</span>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-neutral-700 pt-2">
          {arguments_ && arguments_.length > 0 ? (
            arguments_.map((arg) => (
              <div key={arg.name}>
                <label className="block text-xs text-neutral-500 mb-1">
                  {arg.name}
                  {arg.required && <span className="text-red-400 ml-1">*</span>}
                  {arg.description && <span className="text-neutral-600 ml-1">— {arg.description}</span>}
                </label>
                <input
                  type="text"
                  value={argValues[arg.name] || ""}
                  onChange={(e) =>
                    setArgValues({ ...argValues, [arg.name]: e.target.value })
                  }
                  className="w-full px-2 py-1 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            ))
          ) : (
            <div className="text-xs text-neutral-500">该 Prompt 无参数</div>
          )}

          <button
            onClick={handleGet}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            <Play size={12} />
            {loading ? "获取中..." : "获取 Prompt"}
          </button>

          {result !== null && (
            <div>
              <div className="text-xs text-green-400 mb-1">结果</div>
              <pre className="text-sm font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-neutral-900 p-2 rounded">
                {result}
              </pre>
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
