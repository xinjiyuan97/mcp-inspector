import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import ToolsPanel from "./ToolsPanel";
import ResourcesPanel from "./ResourcesPanel";
import PromptsPanel from "./PromptsPanel";
import DiagnosticPanel from "./DiagnosticPanel";
import ProxyPanel from "./ProxyPanel";
import { Wrench, FileText, MessageSquare, Stethoscope, Radio, Server } from "lucide-react";
import { clsx } from "clsx";

type Tab = "tools" | "resources" | "prompts" | "diagnostic" | "proxy";

const NEEDS_SERVER: Tab[] = ["tools", "resources", "prompts", "diagnostic"];

export default function MainPanel() {
  const { servers, activeServerId } = useServerStore();
  const [tab, setTab] = useState<Tab>("tools");

  const server = activeServerId ? servers[activeServerId] : null;

  const tabs: { id: Tab; label: string; icon: typeof Wrench; count?: number }[] = [
    { id: "tools", label: "工具", icon: Wrench, count: server?.tools.length },
    { id: "resources", label: "资源", icon: FileText, count: server?.resources.length },
    { id: "prompts", label: "Prompts", icon: MessageSquare, count: server?.prompts.length },
    { id: "diagnostic", label: "诊断", icon: Stethoscope },
    { id: "proxy", label: "MITM 代理", icon: Radio },
  ];

  const needsServer = NEEDS_SERVER.includes(tab);

  return (
    <div className="flex flex-col h-full">
      {/* 服务器信息头（仅服务器相关 Tab 显示） */}
      {needsServer && server && (
        <div className="px-4 py-2 border-b border-neutral-700 flex items-center gap-2">
          <span className="font-semibold">{server.config.name}</span>
          <span className="text-xs text-neutral-500">
            {server.config.transport === "Stdio"
              ? `${server.config.command} ${server.config.args.join(" ")}`
              : server.config.url}
          </span>
        </div>
      )}

      {/* Tab 栏 */}
      <div className="flex border-b border-neutral-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2 text-sm transition-colors border-b-2",
              tab === t.id
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            )}
          >
            <t.icon size={14} />
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-neutral-700 text-xs">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {needsServer && !server ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500 gap-3">
            <Server size={48} className="opacity-20" />
            <span className="text-sm">从左侧选择或添加一个 MCP 服务器</span>
          </div>
        ) : tab === "tools" ? (
          <ToolsPanel />
        ) : tab === "resources" ? (
          <ResourcesPanel />
        ) : tab === "prompts" ? (
          <PromptsPanel />
        ) : tab === "diagnostic" ? (
          <DiagnosticPanel />
        ) : tab === "proxy" ? (
          <ProxyPanel />
        ) : null}
      </div>
    </div>
  );
}
