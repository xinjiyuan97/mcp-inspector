import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import AddServerModal from "./AddServerModal";
import ServerContextMenu, { type ContextMenuState } from "./ServerContextMenu";
import { Plus, Server, Trash2, Wifi, WifiOff, Loader2, AlertCircle } from "lucide-react";
import { clsx } from "clsx";
import type { ConnectionStatus, ServerConfig } from "../types";

export default function Sidebar() {
  const {
    servers,
    activeServerId,
    setActiveServer,
    disconnectServer,
    removeServer,
    reconnectServer,
    refreshServer,
  } = useServerStore();
  const [showAdd, setShowAdd] = useState(false);
  const [editServerId, setEditServerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const serverList = Object.values(servers);
  const contextEntry = contextMenu ? servers[contextMenu.serverId] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <span className="text-sm font-semibold text-neutral-300">MCP 服务器</span>
        <button
          onClick={() => setShowAdd(true)}
          className="p-1 rounded hover:bg-neutral-700 transition-colors"
          title="添加服务器"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {serverList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 text-sm gap-2">
            <Server size={32} className="opacity-30" />
            <span>暂无服务器</span>
            <span>点击 + 添加</span>
          </div>
        ) : (
          serverList.map((entry) => (
            <ServerItem
              key={entry.config.id}
              config={entry.config}
              status={entry.status}
              active={activeServerId === entry.config.id}
              onClick={() => setActiveServer(entry.config.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  serverId: entry.config.id,
                });
              }}
              onDisconnect={() => disconnectServer(entry.config.id)}
              onRemove={() => removeServer(entry.config.id)}
            />
          ))
        )}
      </div>

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} />}
      {editServerId && (
        <AddServerModal serverId={editServerId} onClose={() => setEditServerId(null)} />
      )}
      {contextMenu && contextEntry && (
        <ServerContextMenu
          menu={contextMenu}
          canRefresh={contextEntry.status === "connected"}
          isConnecting={contextEntry.status === "connecting"}
          onClose={() => setContextMenu(null)}
          onReconnect={() => void reconnectServer(contextMenu.serverId)}
          onRefresh={() => void refreshServer(contextMenu.serverId)}
          onEdit={() => setEditServerId(contextMenu.serverId)}
        />
      )}
    </div>
  );
}

function ServerItem({
  config,
  status,
  active,
  onClick,
  onContextMenu,
  onDisconnect,
  onRemove,
}: {
  config: ServerConfig;
  status: ConnectionStatus;
  active: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const isError = typeof status === "object" && status !== null && "error" in status;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-neutral-800 transition-colors",
        active ? "bg-neutral-700" : "hover:bg-neutral-800"
      )}
    >
      <div className="flex-shrink-0">
        {isConnected && <Wifi size={14} className="text-green-400" />}
        {isConnecting && <Loader2 size={14} className="text-yellow-400 animate-spin" />}
        {isError && <AlertCircle size={14} className="text-red-400" />}
        {!isConnected && !isConnecting && !isError && <WifiOff size={14} className="text-neutral-500" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{config.name}</div>
        <div className="text-xs text-neutral-500 truncate">
          {config.transport === "Stdio" ? config.command : config.url}
        </div>
        {isError && (
          <div className="text-xs text-red-400 truncate" title={status.error}>
            {status.error}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex gap-1" onClick={(e) => e.stopPropagation()}>
        {isConnected && (
          <button onClick={onDisconnect} className="p-1 rounded hover:bg-neutral-600" title="断开">
            <WifiOff size={12} />
          </button>
        )}
        <button onClick={onRemove} className="p-1 rounded hover:bg-neutral-600" title="删除">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
