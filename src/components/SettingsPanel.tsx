import { Settings } from "lucide-react";
import LlmConfigPanel from "./LlmConfigPanel";
import { useI18n } from "../i18n";

export default function SettingsPanel() {
  const { t } = useI18n();

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto p-3">
      <div className="mb-4 flex items-center gap-2">
        <Settings size={18} className="text-neutral-400" />
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">{t("settings.title")}</h2>
          <p className="text-xs text-neutral-500">{t("settings.llm.title")}</p>
        </div>
      </div>
      <LlmConfigPanel />
    </div>
  );
}
