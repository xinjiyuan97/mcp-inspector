import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";

const STORAGE_KEY = "mcp-inspector-column-widths";
const DEFAULT_LEFT_WIDTH = 224;
const DEFAULT_RIGHT_WIDTH = 320;
const MIN_LEFT_WIDTH = 160;
const MIN_CENTER_WIDTH = 320;
const MIN_RIGHT_WIDTH = 200;
const HANDLE_WIDTH = 6;

function loadWidths(): { left: number; right: number } {
  if (typeof window === "undefined") {
    return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
    const parsed = JSON.parse(raw) as { left?: number; right?: number };
    return {
      left:
        typeof parsed.left === "number" && parsed.left >= MIN_LEFT_WIDTH
          ? parsed.left
          : DEFAULT_LEFT_WIDTH,
      right:
        typeof parsed.right === "number" && parsed.right >= MIN_RIGHT_WIDTH
          ? parsed.right
          : DEFAULT_RIGHT_WIDTH,
    };
  } catch {
    return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
  }
}

function ColumnResizeHandle({
  onResizeStart,
}: {
  onResizeStart: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整栏宽"
      onMouseDown={onResizeStart}
      className={clsx(
        "group relative z-10 shrink-0 cursor-col-resize bg-neutral-800 hover:bg-neutral-700",
        "flex items-center justify-center",
      )}
      style={{ width: HANDLE_WIDTH }}
    >
      <div className="h-10 w-0.5 rounded-full bg-neutral-500 transition-colors group-hover:bg-neutral-300" />
    </div>
  );
}

export default function ResizableColumns({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [{ left: leftWidth, right: rightWidth }, setWidths] = useState(loadWidths);
  const draggingRef = useRef<"left" | "right" | null>(null);
  const startXRef = useRef(0);
  const startLeftRef = useRef(0);
  const startRightRef = useRef(0);

  const clampWidths = useCallback((nextLeft: number, nextRight: number) => {
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    const available = containerWidth - HANDLE_WIDTH * 2;
    const maxLeft = Math.max(MIN_LEFT_WIDTH, available - nextRight - MIN_CENTER_WIDTH);
    const maxRight = Math.max(MIN_RIGHT_WIDTH, available - nextLeft - MIN_CENTER_WIDTH);
    const left = Math.min(maxLeft, Math.max(MIN_LEFT_WIDTH, nextLeft));
    const right = Math.min(maxRight, Math.max(MIN_RIGHT_WIDTH, nextRight));
    return { left, right };
  }, []);

  const persistWidths = useCallback((left: number, right: number) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left, right }));
  }, []);

  const startDrag = (side: "left" | "right") => (event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = side;
    startXRef.current = event.clientX;
    startLeftRef.current = leftWidth;
    startRightRef.current = rightWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - startXRef.current;

      if (draggingRef.current === "left") {
        setWidths(clampWidths(startLeftRef.current + delta, startRightRef.current));
      } else {
        setWidths(clampWidths(startLeftRef.current, startRightRef.current - delta));
      }
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidths((current) => {
        persistWidths(current.left, current.right);
        return current;
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [clampWidths, persistWidths]);

  useEffect(() => {
    const handleResize = () => {
      setWidths((current) => clampWidths(current.left, current.right));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampWidths]);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full min-w-[960px]">
      <div
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
        style={{ width: leftWidth }}
      >
        {left}
      </div>

      <ColumnResizeHandle onResizeStart={startDrag("left")} />

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {center}
      </div>

      <ColumnResizeHandle onResizeStart={startDrag("right")} />

      <div
        className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
        style={{ width: rightWidth }}
      >
        {right}
      </div>
    </div>
  );
}
