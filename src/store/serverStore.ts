import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ServerConfig, ToolInfo, ResourceInfo, PromptInfo, MessageLog, ConnectionStatus } from "../types";

async function invokeWithTimeout<T>(
  command: string,
  args: Record<string, unknown>,
  timeoutSecs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`连接超时（${timeoutSecs} 秒）`)),
      timeoutSecs * 1000,
    );
  });

  try {
    return await Promise.race([invoke<T>(command, args), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  updateServer: (id: string, config: ServerConfig) => void;
  connectServer: (config: ServerConfig) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  reconnectServer: (id: string) => Promise<void>;
  refreshServer: (id: string) => Promise<void>;
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

  updateServer: (id, config) =>
    set((state) => ({
      servers: {
        ...state.servers,
        [id]: {
          ...state.servers[id],
          config: { ...config, id },
        },
      },
    })),

  connectServer: async (config) => {
    set((state) => ({
      servers: {
        ...state.servers,
        [config.id]: { ...state.servers[config.id], status: "connecting" },
      },
    }));

    try {
      await invokeWithTimeout("connect_server", { config }, config.timeout);
      set((state) => ({
        servers: {
          ...state.servers,
          [config.id]: { ...state.servers[config.id], status: "connected" },
        },
      }));
      set({ activeServerId: config.id });
      // 先加载 tools，再加载其他元数据；并行调用会因共享连接锁导致 Codex 等服务器卡住 tools
      void (async () => {
        await get().refreshTools(config.id);
        await Promise.all([
          get().refreshResources(config.id),
          get().refreshPrompts(config.id),
        ]);
      })();
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

  reconnectServer: async (id) => {
    const entry = get().servers[id];
    if (!entry) return;
    if (entry.status === "connected" || entry.status === "connecting") {
      await get().disconnectServer(id);
    }
    await get().connectServer(get().servers[id].config);
  },

  refreshServer: async (id) => {
    const entry = get().servers[id];
    if (!entry || entry.status !== "connected") return;
    await get().refreshTools(id);
    await Promise.all([
      get().refreshResources(id),
      get().refreshPrompts(id),
    ]);
  },

  setActiveServer: (id) => {
    set({ activeServerId: id });
    if (!id) return;
    const entry = get().servers[id];
    if (entry?.status === "connected" && entry.tools.length === 0) {
      void get().refreshTools(id);
    }
  },

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
