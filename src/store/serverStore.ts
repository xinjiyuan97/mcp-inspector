import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ServerConfig, ToolInfo, ResourceInfo, PromptInfo, MessageLog, ConnectionStatus } from "../types";

interface ServerEntry {
  config: ServerConfig;
  status: ConnectionStatus;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
}

interface ServerState {
  servers: Record<string, ServerEntry>;
  activeServerId: string | null;
  messages: MessageLog[];

  addServer: (config: ServerConfig) => void;
  removeServer: (id: string) => void;
  connectServer: (config: ServerConfig) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  setActiveServer: (id: string | null) => void;
  refreshTools: (id: string) => Promise<void>;
  refreshResources: (id: string) => Promise<void>;
  refreshPrompts: (id: string) => Promise<void>;
  addMessage: (msg: MessageLog) => void;
  clearMessages: () => void;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: {},
  activeServerId: null,
  messages: [],

  addServer: (config) =>
    set((state) => ({
      servers: {
        ...state.servers,
        [config.id]: {
          config,
          status: "disconnected",
          tools: [],
          resources: [],
          prompts: [],
        },
      },
    })),

  removeServer: (id) =>
    set((state) => {
      const servers = { ...state.servers };
      delete servers[id];
      return {
        servers,
        activeServerId: state.activeServerId === id ? null : state.activeServerId,
      };
    }),

  connectServer: async (config) => {
    set((state) => ({
      servers: {
        ...state.servers,
        [config.id]: { ...state.servers[config.id], status: "connecting" },
      },
    }));

    try {
      await invoke("connect_server", { config });
      set((state) => ({
        servers: {
          ...state.servers,
          [config.id]: { ...state.servers[config.id], status: "connected" },
        },
      }));
      // 连接成功后自动加载 tools/resources/prompts
      await get().refreshTools(config.id);
      await get().refreshResources(config.id);
      await get().refreshPrompts(config.id);
    } catch (e) {
      set((state) => ({
        servers: {
          ...state.servers,
          [config.id]: { ...state.servers[config.id], status: { error: String(e) } },
        },
      }));
      throw e;
    }
  },

  disconnectServer: async (id) => {
    try {
      await invoke("disconnect_server", { id });
    } catch (e) {
      console.error("disconnect error:", e);
    }
    set((state) => ({
      servers: {
        ...state.servers,
        [id]: { ...state.servers[id], status: "disconnected", tools: [], resources: [], prompts: [] },
      },
    }));
  },

  setActiveServer: (id) => set({ activeServerId: id }),

  refreshTools: async (id) => {
    try {
      const tools = await invoke<ToolInfo[]>("list_tools", { serverId: id });
      set((state) => ({
        servers: {
          ...state.servers,
          [id]: { ...state.servers[id], tools },
        },
      }));
    } catch (e) {
      console.error("list_tools error:", e);
    }
  },

  refreshResources: async (id) => {
    try {
      const resources = await invoke<ResourceInfo[]>("list_resources", { serverId: id });
      set((state) => ({
        servers: {
          ...state.servers,
          [id]: { ...state.servers[id], resources },
        },
      }));
    } catch (e) {
      console.error("list_resources error:", e);
    }
  },

  refreshPrompts: async (id) => {
    try {
      const prompts = await invoke<PromptInfo[]>("list_prompts", { serverId: id });
      set((state) => ({
        servers: {
          ...state.servers,
          [id]: { ...state.servers[id], prompts },
        },
      }));
    } catch (e) {
      console.error("list_prompts error:", e);
    }
  },

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  clearMessages: () => set({ messages: [] }),
}));
