import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerStore } from "../store/serverStore";
import { FileText, ChevronRight } from "lucide-react";

export default function ResourcesPanel() {
  const { servers, activeServerId } = useServerStore();
  const server = activeServerId ? servers[activeServerId] : null;

  if (!server) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-neutral-500 gap-2">
        <FileText size={32} className="opacity-20" />
        <span className="text-sm">暂无资源</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      <ReadByUriSection serverId={activeServerId!} />

      {server.resources.length === 0 ? (
        <div className="text-center text-neutral-500 text-sm py-6">
          资源列表为空。部分 MCP 服务器支持直接按 URI 读取未列出的资源。
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-xs text-neutral-500 px-1">已列出资源</div>
          {server.resources.map((res) => (
            <ResourceItem
              key={res.uri}
              uri={res.uri}
              name={res.name}
              description={res.description}
              serverId={activeServerId!}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReadByUriSection({ serverId }: { serverId: string }) {
  const [uri, setUri] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRead = async () => {
    const trimmed = uri.trim();
    if (!trimmed) {
      setError("请输入资源 URI");
      return;
    }

    setLoading(true);
    setError(null);
    setContent(null);
    try {
      const res = await invoke<string>("read_resource", { serverId, uri: trimmed });
      setContent(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-neutral-700 rounded-lg p-3 space-y-2">
      <div className="text-xs text-neutral-400">按 URI 读取</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleRead();
          }}
          placeholder="例如: file:///path/to/file 或 custom://resource/id"
          className="flex-1 px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm font-mono focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={() => void handleRead()}
          disabled={loading}
          className="px-3 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 shrink-0"
        >
          {loading ? "读取中..." : "读取"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        MCP 的 resources/read 可直接按 URI 读取，不要求资源出现在 resources/list 中。
      </p>

      {content !== null && (
        <pre className="text-sm font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-neutral-900 p-2 rounded border border-neutral-700">
          {content}
        </pre>
      )}

      {error && <div className="text-sm text-red-300">{error}</div>}
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
      setContent(null);
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

      {loading && <div className="px-3 py-2 text-sm text-neutral-400">加载中...</div>}

      {content !== null && (
        <div className="px-3 pb-3 border-t border-neutral-700 pt-2">
          <pre className="text-sm font-mono whitespace-pre-wrap break-all max-h-96 overflow-y-auto bg-neutral-900 p-2 rounded">
            {content}
          </pre>
        </div>
      )}

      {error && <div className="px-3 py-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}
