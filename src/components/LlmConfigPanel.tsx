import { useEffect, useMemo, useState } from "react";
import { Plus, Star, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import { LLM_PRESETS } from "../constants/llmPresets";
import { useLlmStore } from "../store/llmStore";
import { useI18n } from "../i18n";
import { FormField } from "./ui/FormControls";
import { Checkbox } from "react-aria-components";
import type { ApiFormat, LlmConfig } from "../types";

function emptyCustomConfig(): LlmConfig {
  return {
    name: "",
    api_format: "open_ai",
    base_url: "",
    api_key: "",
    model: "",
    temperature: 0.7,
  };
}

export default function LlmConfigPanel() {
  const { t } = useI18n();
  const {
    configs,
    activeConfigName,
    addFromPreset,
    addCustomConfig,
    updateConfig,
    removeConfig,
    setActiveConfig,
    hasConfig,
    getReadyConfigs,
  } = useLlmStore();
  const [customDraft, setCustomDraft] = useState<LlmConfig | null>(null);

  const readyCount = getReadyConfigs().length;

  const handleAddCustom = () => {
    if (!customDraft) return;
    if (!customDraft.name.trim() || !customDraft.model.trim() || !customDraft.base_url.trim()) {
      return;
    }
    addCustomConfig({
      ...customDraft,
      name: customDraft.name.trim(),
      model: customDraft.model.trim(),
      base_url: customDraft.base_url.trim(),
    });
    setCustomDraft(null);
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-neutral-400">
        {t("settings.llm.summary").replace("{ready}", String(readyCount)).replace("{total}", String(configs.length))}
      </div>

      <div>
        <div className="mb-2 text-xs text-neutral-500">{t("settings.llm.presets")}</div>
        <div className="flex flex-wrap gap-2">
          {LLM_PRESETS.map((preset) => {
            const added = hasConfig(preset.name);
            return (
              <button
                key={preset.name}
                type="button"
                disabled={added}
                onClick={() => addFromPreset(preset.name)}
                className={clsx(
                  "rounded px-2 py-1 text-xs",
                  added
                    ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                    : "bg-neutral-700 text-neutral-300 hover:bg-neutral-600",
                )}
              >
                {added ? "✓ " : "+ "}
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-neutral-500">{t("settings.llm.configured")}</div>
        {configs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-6 text-center text-sm text-neutral-500">
            {t("settings.llm.empty")}
          </div>
        ) : (
          configs.map((config) => (
            <LlmConfigCard
              key={config.name}
              config={config}
              isActive={activeConfigName === config.name}
              onSave={(next) => updateConfig(config.name, next)}
              onRemove={() => removeConfig(config.name)}
              onSetActive={() => setActiveConfig(config.name)}
            />
          ))
        )}
      </div>

      {customDraft ? (
        <div className="space-y-3 rounded-lg border border-neutral-700 overflow-hidden">
          <div className="border-b border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-200">
            {t("settings.llm.addCustom")}
          </div>
          <div className="space-y-3 px-3 pb-3">
            <LlmConfigFields value={customDraft} onChange={setCustomDraft} />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddCustom}
                className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
              >
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => setCustomDraft(null)}
                className="ra-link-button px-1 py-1.5"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCustomDraft(emptyCustomConfig())}
          className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-600"
        >
          <Plus size={14} />
          {t("settings.llm.addCustom")}
        </button>
      )}
    </div>
  );
}

function LlmConfigCard({
  config,
  isActive,
  onSave,
  onRemove,
  onSetActive,
}: {
  config: LlmConfig;
  isActive: boolean;
  onSave: (next: LlmConfig) => void;
  onRemove: () => void;
  onSetActive: () => void;
}) {
  const { t } = useI18n();
  const ready = config.api_key.trim().length > 0;
  const [expanded, setExpanded] = useState(() => !ready);
  const [draft, setDraft] = useState(config);
  const [savedHint, setSavedHint] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(config),
    [draft, config],
  );

  const handleSave = () => {
    onSave(draft);
    setSavedHint(true);
    window.setTimeout(() => setSavedHint(false), 1500);
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-700">
      <div
        className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-neutral-800"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="truncate text-sm font-medium text-blue-400">{config.name}</span>
          <span
            className={clsx(
              "rounded px-1.5 py-0.5 text-[10px]",
              ready ? "bg-green-900/40 text-green-300" : "bg-neutral-700 text-neutral-400",
            )}
          >
            {ready ? t("settings.llm.ready") : t("settings.llm.missingKey")}
          </span>
          {isActive && (
            <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">
              {t("settings.llm.default")}
            </span>
          )}
          {isDirty && (
            <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300">
              {t("settings.llm.unsaved")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onSetActive}
            title={t("settings.llm.setDefault")}
            className={clsx(
              "rounded p-1 hover:bg-neutral-700",
              isActive ? "text-yellow-400" : "text-neutral-500",
            )}
          >
            <Star size={14} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            title={t("common.delete")}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-700 hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-neutral-700 px-3 py-3">
          <LlmConfigFields value={draft} onChange={setDraft} disableNameEdit />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.save")}
            </button>
            {savedHint && (
              <span className="text-xs text-green-400">{t("settings.llm.saved")}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LlmConfigFields({
  value,
  onChange,
  disableNameEdit = false,
}: {
  value: LlmConfig;
  onChange: (next: LlmConfig) => void;
  disableNameEdit?: boolean;
}) {
  const { t } = useI18n();

  const update = (key: keyof LlmConfig, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <div className="space-y-3">
      <FormField
        label={t("settings.llm.displayName")}
        type="string"
        value={value.name}
        onChange={(v) => update("name", v)}
        disabled={disableNameEdit}
        required
      />
      <FormField
        label={t("settings.llm.apiFormat")}
        type="string"
        value={value.api_format}
        onChange={(v) => update("api_format", v as ApiFormat)}
        selectOptions={[
          { value: "open_ai", label: "OpenAI Compatible" },
          { value: "anthropic", label: "Anthropic" },
        ]}
      />
      <FormField
        label={t("settings.llm.model")}
        type="string"
        value={value.model}
        onChange={(v) => update("model", v)}
        required
      />
      <FormField
        label={t("settings.llm.temperature")}
        type="number"
        value={value.temperature ?? 0.7}
        onChange={(v) => update("temperature", v === "" ? 0.7 : Number(v))}
      />
      <FormField
        label={t("settings.llm.baseUrl")}
        type="string"
        value={value.base_url}
        onChange={(v) => update("base_url", v)}
        required
      />
      <FormField
        label={t("settings.llm.apiKey")}
        type="password"
        value={value.api_key}
        onChange={(v) => update("api_key", v)}
        placeholder="sk-..."
      />
    </div>
  );
}

export function LlmConfigSelector({
  mode,
  onOpenSettings,
}: {
  mode: "single" | "compare";
  onOpenSettings?: () => void;
}) {
  const { t } = useI18n();
  const {
    configs,
    activeConfigName,
    enabledConfigNames,
    getReadyConfigs,
    getActiveConfig,
    getReadyEnabledConfigs,
    setActiveConfig,
    toggleEnabled,
    isEnabled,
  } = useLlmStore();

  const readyConfigs = getReadyConfigs();
  const activeConfig = getActiveConfig();
  const readyEnabled = getReadyEnabledConfigs();

  if (configs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-700 px-3 py-4 text-sm text-neutral-400">
        <p>{t("settings.llm.notConfigured")}</p>
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="ra-link-button mt-2">
            {t("settings.open")}
          </button>
        )}
      </div>
    );
  }

  if (mode === "single") {
    return (
      <div className="space-y-3 rounded-lg border border-neutral-700 px-3 py-3">
        {onOpenSettings && (
          <div className="flex justify-end">
            <button type="button" onClick={onOpenSettings} className="ra-link-button">
              {t("settings.open")}
            </button>
          </div>
        )}
        <FormField
          label={t("settings.llm.selectModel")}
          type="string"
          value={activeConfigName ?? activeConfig?.name ?? ""}
          onChange={(v) => setActiveConfig(String(v))}
          selectOptions={configs.map((config) => ({
            value: config.name,
            label: config.api_key.trim()
              ? config.name
              : `${config.name} (${t("settings.llm.missingKey")})`,
          }))}
        />
        {activeConfig ? (
          <div className="text-xs text-neutral-500">
            {t("settings.llm.usingModel")}: <span className="font-mono text-neutral-300">{activeConfig.model}</span>
          </div>
        ) : (
          <div className="text-xs text-yellow-400">{t("diagnostic.needLlm")}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-700 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-neutral-300">
          {t("settings.llm.compareModels")} ({readyEnabled.length}/{readyConfigs.length})
        </span>
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="ra-link-button">
            {t("settings.open")}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {configs.map((config) => {
          const ready = config.api_key.trim().length > 0;
          const checked = isEnabled(config.name);
          return (
            <Checkbox
              key={config.name}
              aria-label={config.name}
              isSelected={checked}
              isDisabled={!ready}
              onChange={() => toggleEnabled(config.name)}
              className={clsx(
                "ra-checkbox flex w-full items-center gap-2 rounded border px-2 py-1.5",
                checked ? "border-green-700/60 bg-green-900/20" : "border-neutral-700 bg-neutral-800/40",
                !ready && "opacity-60",
              )}
            >
              <span className="ra-checkbox-box">✓</span>
              <span className="truncate text-neutral-200">{config.name}</span>
            </Checkbox>
          );
        })}
      </div>
      {enabledConfigNames.length === 0 && (
        <div className="text-xs text-neutral-500">{t("settings.llm.enableHint")}</div>
      )}
    </div>
  );
}
