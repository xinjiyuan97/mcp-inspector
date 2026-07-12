import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import type { ServerConfig, TransportType } from "../types";
import { X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

function configToForm(config: ServerConfig) {
  return {
    name: config.name,
    transport: config.transport,
    command: config.command ?? "",
    args: config.args.join(" "),
    url: config.url ?? "",
    timeout: String(config.timeout),
  };
}

export default function AddServerModal({
  onClose,
  serverId,
}: {
  onClose: () => void;
  serverId?: string;
}) {
  const isEdit = Boolean(serverId);
  const entry = useServerStore((s) => (serverId ? s.servers[serverId] : undefined));
  const { addServer, updateServer, connectServer, reconnectServer } = useServerStore();

  const initial = entry?.config;
  const [name, setName] = useState(() => (initial ? configToForm(initial).name : ""));
  const [transport, setTransport] = useState<TransportType>(
    () => (initial ? configToForm(initial).transport : "Stdio"),
  );
  const [command, setCommand] = useState(() => (initial ? configToForm(initial).command : ""));
  const [args, setArgs] = useState(() => (initial ? configToForm(initial).args : ""));
  const [url, setUrl] = useState(() => (initial ? configToForm(initial).url : ""));
  const [timeout, setTimeoutValue] = useState(() => (initial ? configToForm(initial).timeout : "30"));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const applyCodexPreset = () => {
    setName("Codex");
    setTransport("Stdio");
    setCommand("codex");
    setArgs("mcp-server");
    setUrl("");
    setError(null);
  };

  const buildConfig = (): ServerConfig | null => {
    if (!name.trim()) {
      setError("请输入服务器名称");
      return null;
    }
    if (transport === "Stdio" && !command.trim()) {
      setError("请输入命令");
      return null;
    }
    if (transport === "Http" && !url.trim()) {
      setError("请输入 URL");
      return null;
    }

    const timeoutNum = Number(timeout);
    if (!Number.isFinite(timeoutNum) || timeoutNum <= 0) {
      setError("超时时间必须是正数");
      return null;
    }

    return {
      id: serverId ?? uuidv4(),
      name: name.trim(),
      transport,
      command: transport === "Stdio" ? command.trim() : undefined,
      args: transport === "Stdio" ? (args.trim() ? args.trim().split(/\s+/) : []) : [],
      env: initial?.env ?? {},
      url: transport === "Http" ? url.trim() : undefined,
      headers: initial?.headers ?? {},
      timeout: timeoutNum,
    };
  };

  const handleSubmit = async () => {
    const config = buildConfig();
    if (!config) return;

    setSubmitting(true);
    setError(null);

    try {
      if (isEdit && serverId) {
        const wasConnected = entry?.status === "connected";
        updateServer(serverId, config);
        if (wasConnected) {
          await reconnectServer(serverId);
        }
        onClose();
        return;
      }

      addServer(config);
      await connectServer(config);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-neutral-800 rounded-lg p-6 w-[480px] max-w-[90vw] border border-neutral-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isEdit ? "服务器属性" : "添加 MCP 服务器"}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-700">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm text-neutral-400 mb-1">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: filesystem"
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm text-neutral-400 mb-1">传输类型</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTransport("Stdio")}
              className={`px-3 py-1.5 rounded text-sm ${transport === "Stdio" ? "bg-blue-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
            >
              Stdio
            </button>
            <button
              onClick={() => setTransport("Http")}
              className={`px-3 py-1.5 rounded text-sm ${transport === "Http" ? "bg-blue-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
            >
              HTTP
            </button>
            {!isEdit && (
              <button
                onClick={applyCodexPreset}
                className="px-3 py-1.5 rounded text-sm bg-neutral-700 hover:bg-neutral-600 ml-auto"
              >
                填入 Codex
              </button>
            )}
          </div>
        </div>

        {transport === "Stdio" && (
          <>
            <div className="mb-4">
              <label className="block text-sm text-neutral-400 mb-1">命令</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="例如: npx"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm text-neutral-400 mb-1">参数（空格分隔）</label>
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="例如: -y @modelcontextprotocol/server-filesystem /tmp"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </>
        )}

        {transport === "Http" && (
          <div className="mb-4">
            <label className="block text-sm text-neutral-400 mb-1">URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="例如: http://localhost:3000/mcp"
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm text-neutral-400 mb-1">连接超时（秒）</label>
          <input
            type="number"
            min={1}
            value={timeout}
            onChange={(e) => setTimeoutValue(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-600 rounded text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {error && (
          <div className="mb-4 p-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-neutral-700 hover:bg-neutral-600"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? (isEdit ? "保存中..." : "连接中...") : isEdit ? "保存" : "连接"}
          </button>
        </div>

        {!isEdit && (
          <div className="mt-4 pt-4 border-t border-neutral-700 text-xs text-neutral-500">
            <p className="mb-1">常见示例：</p>
            <p>• 文件系统: 命令 <code className="text-neutral-400">npx</code>，参数 <code className="text-neutral-400">-y @modelcontextprotocol/server-filesystem /tmp</code></p>
            <p>• GitHub: 命令 <code className="text-neutral-400">npx</code>，参数 <code className="text-neutral-400">-y @modelcontextprotocol/server-github</code></p>
            <p className="mt-2 text-neutral-600">提示：命令和参数需分开填写；Codex 配置为命令 <code className="text-neutral-400">codex</code>，参数 <code className="text-neutral-400">mcp-server</code>。</p>
          </div>
        )}
      </div>
    </div>
  );
}
