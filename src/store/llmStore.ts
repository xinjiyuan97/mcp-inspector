import { create } from "zustand";
import { LLM_PRESETS } from "../constants/llmPresets";
import type { LlmConfig } from "../types";

const STORAGE_KEY = "mcp-inspector-llm-config";

interface PersistedLlmState {
  configs: LlmConfig[];
  activeConfigName: string | null;
  enabledConfigNames: string[];
}

interface LlmState extends PersistedLlmState {
  getReadyConfigs: () => LlmConfig[];
  getActiveConfig: () => LlmConfig | undefined;
  getReadyEnabledConfigs: () => LlmConfig[];
  getDefaultToolModel: () => string | undefined;
  addFromPreset: (presetName: string) => void;
  addCustomConfig: (config: LlmConfig) => void;
  updateConfig: (name: string, patch: Partial<LlmConfig>) => void;
  removeConfig: (name: string) => void;
  toggleEnabled: (name: string) => void;
  setActiveConfig: (name: string) => void;
  isEnabled: (name: string) => boolean;
  hasConfig: (name: string) => boolean;
}

function loadPersistedState(): PersistedLlmState {
  if (typeof window === "undefined") {
    return { configs: [], activeConfigName: null, enabledConfigNames: [] };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { configs: [], activeConfigName: null, enabledConfigNames: [] };
    }
    const parsed = JSON.parse(raw) as PersistedLlmState;
    return {
      configs: Array.isArray(parsed.configs) ? parsed.configs : [],
      activeConfigName: parsed.activeConfigName ?? null,
      enabledConfigNames: Array.isArray(parsed.enabledConfigNames) ? parsed.enabledConfigNames : [],
    };
  } catch {
    return { configs: [], activeConfigName: null, enabledConfigNames: [] };
  }
}

function persistState(state: PersistedLlmState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function withPersist(
  set: (partial: Partial<PersistedLlmState> | ((state: LlmState) => Partial<PersistedLlmState>)) => void,
  get: () => LlmState,
  partial: Partial<PersistedLlmState>,
) {
  set(partial);
  const { configs, activeConfigName, enabledConfigNames } = get();
  persistState({ configs, activeConfigName, enabledConfigNames });
}

const initialState = loadPersistedState();

export const useLlmStore = create<LlmState>((set, get) => ({
  ...initialState,

  getReadyConfigs: () => get().configs.filter((c) => c.api_key.trim().length > 0),

  getActiveConfig: () => {
    const { configs, activeConfigName } = get();
    const active = configs.find((c) => c.name === activeConfigName && c.api_key.trim());
    if (active) return active;
    return configs.find((c) => c.api_key.trim());
  },

  getReadyEnabledConfigs: () => {
    const { enabledConfigNames } = get();
    return get()
      .getReadyConfigs()
      .filter((c) => enabledConfigNames.includes(c.name));
  },

  getDefaultToolModel: () => get().getActiveConfig()?.model,

  addFromPreset: (presetName) => {
    const preset = LLM_PRESETS.find((p) => p.name === presetName);
    if (!preset) return;

    const existing = get().configs.find((c) => c.name === presetName);
    if (existing) return;

    const nextConfigs = [...get().configs, { ...preset }];
    const nextEnabled = [...get().enabledConfigNames, presetName];
    const nextActive = get().activeConfigName ?? presetName;

    withPersist(set, get, {
      configs: nextConfigs,
      enabledConfigNames: nextEnabled,
      activeConfigName: nextActive,
    });
  },

  addCustomConfig: (config) => {
    if (!config.name.trim()) return;
    if (get().configs.some((c) => c.name === config.name)) return;

    const nextConfigs = [...get().configs, config];
    const nextEnabled = [...get().enabledConfigNames, config.name];
    const nextActive = get().activeConfigName ?? config.name;

    withPersist(set, get, {
      configs: nextConfigs,
      enabledConfigNames: nextEnabled,
      activeConfigName: nextActive,
    });
  },

  updateConfig: (name, patch) => {
    withPersist(set, get, {
      configs: get().configs.map((c) => (c.name === name ? { ...c, ...patch } : c)),
    });
  },

  removeConfig: (name) => {
    const nextConfigs = get().configs.filter((c) => c.name !== name);
    const nextEnabled = get().enabledConfigNames.filter((n) => n !== name);
    const nextActive = get().activeConfigName === name ? (nextConfigs[0]?.name ?? null) : get().activeConfigName;

    withPersist(set, get, {
      configs: nextConfigs,
      enabledConfigNames: nextEnabled,
      activeConfigName: nextActive,
    });
  },

  toggleEnabled: (name) => {
    const enabled = get().enabledConfigNames;
    const nextEnabled = enabled.includes(name)
      ? enabled.filter((n) => n !== name)
      : [...enabled, name];

    withPersist(set, get, { enabledConfigNames: nextEnabled });
  },

  setActiveConfig: (name) => {
    withPersist(set, get, { activeConfigName: name });
  },

  isEnabled: (name) => get().enabledConfigNames.includes(name),

  hasConfig: (name) => get().configs.some((c) => c.name === name),
}));
