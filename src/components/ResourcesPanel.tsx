import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import { FileText, ChevronRight } from "lucide-react";

export default function ResourcesPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;

  if (!server || server.resources.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-neutral-500 gap-2">
        <FileText size={32} className="opacity-20" />
        <span className="text-sm">暂无资源</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
      {server.resources.map((res) => (
        <ResourceItem key={res.uri} uri={res.uri} name={res.name} description={res.description} serverId={activeServerId!} />
      ))}
    </div>
  );
}

function ResourceItem({
  uri,
  name,
  serverId,
}: {
  uri: string;
  name: string;
  description?: string;
  serverId: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRead = async () => {
    if (content !== null) {
      setContent(null); // toggle off
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<string>("read_resource", { serverId, uri });
      setContent(res);
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
        onClick={handleRead}
      >
        <ChevronRight size={14} />
        <span className="font-mono text-sm text-blue-400">{name}</span>
        <span className="text-xs text-neutral-500 truncate flex-1">{uri}</span>
      </div>

      {loading && (
        <div className="px-3 py-2 text-sm text-neutral-400">加载中...</div>
      )}

      {content !== null && (
        <div className="px-3 pb-3 border-t border-neutral-700 pt-2">
          <pre className="text-sm font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-neutral-900 p-2 rounded">
            {content}
          </pre>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 text-sm text-red-300">{error}</div>
      )}
    </div>
  );
}
