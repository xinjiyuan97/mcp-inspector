import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import type { ServerConfig, TransportType } from "../types";
import { X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";

export default function AddServerModal({ onClose }: { onClose: () => void }) {
  const { addServer, connectServer } = useServerStore();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<TransportType>("Stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    if (!name.trim()) {
      setError("请输入服务器名称");
      return;
    }

    if (transport === "Stdio" && !command.trim()) {
      setError("请输入命令");
      return;
    }
    if (transport === "Http" && !url.trim()) {
      setError("请输入 URL");
      return;
    }

    const config: ServerConfig = {
      id: uuidv4(),
      name: name.trim(),
      transport,
      command: transport === "Stdio" ? command.trim() : undefined,
      args: transport === "Stdio" ? (args.trim() ? args.trim().split(/\s+/) : []) : [],
      env: {},
      url: transport === "Http" ? url.trim() : undefined,
      headers: {},
      timeout: 30,
    };

    setConnecting(true);
    setError(null);
    addServer(config);
    try {
      await connectServer(config);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-neutral-800 rounded-lg p-6 w-[480px] max-w-[90vw] border border-neutral-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">添加 MCP 服务器</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-700">
            <X size={18} />
          </button>
        </div>

        {/* 名称 */}
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

        {/* Transport 类型 */}
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
          </div>
        </div>

        {/* Stdio 配置 */}
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

        {/* HTTP 配置 */}
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

        {/* 错误信息 */}
        {error && (
          <div className="mb-4 p-2 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            {error}
          </div>
        )}

        {/* 按钮 */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-neutral-700 hover:bg-neutral-600"
          >
            取消
          </button>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
          >
            {connecting ? "连接中..." : "连接"}
          </button>
        </div>

        {/* 示例提示 */}
        <div className="mt-4 pt-4 border-t border-neutral-700 text-xs text-neutral-500">
          <p className="mb-1">常见示例：</p>
          <p>• 文件系统: <code className="text-neutral-400">npx -y @modelcontextprotocol/server-filesystem /tmp</code></p>
          <p>• GitHub: <code className="text-neutral-400">npx -y @modelcontextprotocol/server-github</code></p>
        </div>
      </div>
    </div>
  );
}
