import { useCallback, useEffect, useRef, useState } from "react";
import { useServerStore } from "../store/serverStore";
import JsonViewer from "./JsonViewer";
import { ArrowRight, ArrowLeft, Trash2, Radio } from "lucide-react";
import { clsx } from "clsx";
import type { MessageLog } from "../types";

const DETAIL_HEIGHT_KEY = "mcp-inspector-message-detail-height";
const DEFAULT_DETAIL_HEIGHT = 220;
const MIN_DETAIL_HEIGHT = 120;
const MIN_LIST_HEIGHT = 120;

function loadDetailHeight(): number {
  if (typeof window === "undefined") return DEFAULT_DETAIL_HEIGHT;
  const raw = localStorage.getItem(DETAIL_HEIGHT_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= MIN_DETAIL_HEIGHT ? parsed : DEFAULT_DETAIL_HEIGHT;
}

export default function MessageLog() {
  const { messages, clearMessages } = useServerStore();
  const [selected, setSelected] = useState<MessageLog | null>(null);
  const [detailHeight, setDetailHeight] = useState(loadDetailHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const clampDetailHeight = useCallback((next: number) => {
    const containerHeight = containerRef.current?.clientHeight ?? 0;
    const headerHeight = 41;
    const maxDetail = Math.max(
      MIN_DETAIL_HEIGHT,
      containerHeight - headerHeight - MIN_LIST_HEIGHT,
    );
    return Math.min(maxDetail, Math.max(MIN_DETAIL_HEIGHT, next));
  }, []);

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    startYRef.current = event.clientY;
    startHeightRef.current = detailHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - event.clientY;
      setDetailHeight(clampDetailHeight(startHeightRef.current + delta));
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDetailHeight((current) => {
        localStorage.setItem(DETAIL_HEIGHT_KEY, String(current));
        return current;
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clampDetailHeight]);

  useEffect(() => {
    const handleResize = () => {
      setDetailHeight((current) => clampDetailHeight(current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampDetailHeight]);

  const editorHeight = Math.max(80, detailHeight - 44);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-green-400" />
          <span className="text-sm font-semibold text-neutral-300">消息日志</span>
          <span className="text-xs text-neutral-500">({messages.length})</span>
        </div>
        {messages.length > 0 && (
          <button onClick={clearMessages} className="rounded p-1 hover:bg-neutral-700" title="清空">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500">
            <Radio size={32} className="opacity-20" />
            <span className="text-sm">暂无消息</span>
            <span className="px-4 text-center text-xs text-neutral-600">
              操作 MCP 服务器时将记录 JSON-RPC 消息
            </span>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {messages.map((msg) => (
              <div
                key={msg.id}
                onClick={() => setSelected(msg)}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-neutral-800",
                  selected?.id === msg.id && "bg-neutral-700",
                )}
              >
                <div className="shrink-0">
                  {msg.direction === "request" && <ArrowRight size={12} className="text-blue-400" />}
                  {msg.direction === "response" && <ArrowLeft size={12} className="text-green-400" />}
                  {msg.direction === "notification" && <ArrowLeft size={12} className="text-yellow-400" />}
                  {msg.direction === "error" && <ArrowLeft size={12} className="text-red-400" />}
                </div>

                <span className="flex-1 truncate font-mono text-xs text-neutral-300">
                  {msg.method || "—"}
                </span>

                {msg.duration_ms !== null && msg.duration_ms !== undefined && (
                  <span className="text-xs text-neutral-500">{msg.duration_ms}ms</span>
                )}

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
        <div
          className="flex shrink-0 flex-col overflow-hidden border-t border-neutral-700"
          style={{ height: detailHeight }}
        >
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖动调整详情区域高度"
            onMouseDown={handleResizeStart}
            className="group flex h-2 shrink-0 cursor-ns-resize items-center justify-center border-b border-neutral-700/80 bg-neutral-800/60 hover:bg-neutral-700/80"
          >
            <div className="h-0.5 w-10 rounded-full bg-neutral-500 transition-colors group-hover:bg-neutral-300" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col p-2">
            <div className="mb-1 shrink-0 text-xs text-neutral-500">
              {selected.method || "—"} · {selected.direction}
            </div>
            <div className="min-h-0 flex-1">
              <JsonViewer value={selected.payload} maxHeight={`${editorHeight}px`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
