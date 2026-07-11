import { create } from "zustand";

export type MainTab =
  | "tools"
  | "resources"
  | "prompts"
  | "diagnostic"
  | "proxy"
  | "recording"
  | "settings";

interface UiState {
  mainTab: MainTab;
  setMainTab: (tab: MainTab) => void;
  openSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mainTab: "tools",
  setMainTab: (tab) => set({ mainTab: tab }),
  openSettings: () => set({ mainTab: "settings" }),
}));
