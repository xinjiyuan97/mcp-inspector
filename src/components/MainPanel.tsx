import { useState } from "react";
import { useServerStore } from "../store/serverStore";
import ToolsPanel from "./ToolsPanel";
import ResourcesPanel from "./ResourcesPanel";
import PromptsPanel from "./PromptsPanel";
import DiagnosticPanel from "./DiagnosticPanel";
import ProxyPanel from "./ProxyPanel";
import RecordingPanel from "./RecordingPanel";
import { Wrench, FileText, MessageSquare, Stethoscope, Radio, Circle, Server } from "lucide-react";
import { clsx } from "clsx";
import { useI18n } from "../i18n";

type Tab = "tools" | "resources" | "prompts" | "diagnostic" | "proxy" | "recording";

const NEEDS_SERVER: Tab[] = ["tools", "resources", "prompts", "diagnostic"];

export default function MainPanel() {
  const { t } = useI18n();
  const { servers, activeServerId } = useServerStore();
  const [tab, setTab] = useState<Tab>("tools");

  const server = activeServerId ? servers[activeServerId] : null;

  const tabs: { id: Tab; label: string; icon: typeof Wrench; count?: number }[] = [
    { id: "tools", label: t("tabs.tools"), icon: Wrench, count: server?.tools.length },
    { id: "resources", label: t("tabs.resources"), icon: FileText, count: server?.resources.length },
    { id: "prompts", label: t("tabs.prompts"), icon: MessageSquare, count: server?.prompts.length },
    { id: "diagnostic", label: t("tabs.diagnostic"), icon: Stethoscope },
    { id: "proxy", label: t("tabs.proxy"), icon: Radio },
    { id: "recording", label: t("tabs.recording"), icon: Circle },
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
            <span className="text-sm">{t("main.selectServer")}</span>
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
        ) : tab === "recording" ? (
          <RecordingPanel />
        ) : null}
      </div>
    </div>
  );
}
