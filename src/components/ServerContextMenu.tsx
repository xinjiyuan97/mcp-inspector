import { useEffect, useRef } from "react";
import { clsx } from "clsx";

export interface ContextMenuState {
  x: number;
  y: number;
  serverId: string;
}

interface ServerContextMenuProps {
  menu: ContextMenuState;
  canRefresh: boolean;
  isConnecting: boolean;
  onClose: () => void;
  onReconnect: () => void;
  onRefresh: () => void;
  onEdit: () => void;
}

export default function ServerContextMenu({
  menu,
  canRefresh,
  isConnecting,
  onClose,
  onReconnect,
  onRefresh,
  onEdit,
}: ServerContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const clampedX = Math.min(menu.x, window.innerWidth - 180);
  const clampedY = Math.min(menu.y, window.innerHeight - 140);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[168px] rounded-md border border-neutral-600 bg-neutral-800 py-1 shadow-lg"
      style={{ left: clampedX, top: clampedY }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        label="重新连接"
        disabled={isConnecting}
        onClick={() => {
          onReconnect();
          onClose();
        }}
      />
      <MenuItem
        label="刷新"
        disabled={!canRefresh || isConnecting}
        onClick={() => {
          onRefresh();
          onClose();
        }}
      />
      <div className="my-1 border-t border-neutral-700" />
      <MenuItem
        label="查看属性"
        onClick={() => {
          onEdit();
          onClose();
        }}
      />
    </div>
  );
}

function MenuItem({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "w-full px-3 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-neutral-600"
          : "text-neutral-200 hover:bg-neutral-700",
      )}
    >
      {label}
    </button>
  );
}
