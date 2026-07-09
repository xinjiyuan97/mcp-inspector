import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import JsonViewer from "./JsonViewer";
import { ArrowRight, ArrowLeft, Trash2, Radio } from "lucide-react";
import { clsx } from "clsx";
import type { MessageLog } from "../types";

export default function MessageLog() {
  const { messages, clearMessages } = useServerStore();
  const [selected, setSelected] = useState<MessageLog | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-green-400" />
          <span className="text-sm font-semibold text-neutral-300">消息日志</span>
          <span className="text-xs text-neutral-500">({messages.length})</span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearMessages} className="p-1 rounded hover:bg-neutral-700" title="清空">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-2">
            <Radio size={32} className="opacity-20" />
            <span className="text-sm">暂无消息</span>
            <span className="text-xs text-neutral-600">操作 MCP 服务器时将记录 JSON-RPC 消息</span>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {messages.map((msg) => (
              <div
                key={msg.id}
                onClick={() => setSelected(msg)}
                className={clsx(
                  "flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-neutral-800 transition-colors",
                  selected?.id === msg.id && "bg-neutral-700"
                )}
              >
                {/* 方向箭头 */}
                <div className="flex-shrink-0">
                  {msg.direction === "request" && <ArrowRight size={12} className="text-blue-400" />}
                  {msg.direction === "response" && <ArrowLeft size={12} className="text-green-400" />}
                  {msg.direction === "notification" && <ArrowLeft size={12} className="text-yellow-400" />}
                  {msg.direction === "error" && <ArrowLeft size={12} className="text-red-400" />}
                </div>

                {/* 方法名 */}
                <span className="text-xs font-mono text-neutral-300 truncate flex-1">
                  {msg.method || "—"}
                </span>

                {/* 耗时 */}
                {msg.duration_ms !== null && msg.duration_ms !== undefined && (
                  <span className="text-xs text-neutral-500">{msg.duration_ms}ms</span>
                )}

                {/* 时间戳 */}
                <span className="text-xs text-neutral-600">
                  {new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 选中消息详情 */}
      {selected && (
        <div className="border-t border-neutral-700 p-2 max-h-[50%]">
          <div className="text-xs text-neutral-500 mb-1">
            {selected.method || "—"} · {selected.direction}
          </div>
          <JsonViewer value={selected.payload} maxHeight="200px" />
        </div>
      )}
    </div>
  );
}
