import { create } from "zustand";
import zhCN from "./zh-CN.json";
import enUS from "./en-US.json";

export type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

interface I18nState {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set, get) => ({
  locale: "zh-CN",
  t: (key: string) => {
    const { locale } = get();
    return messages[locale][key] ?? key;
  },
  setLocale: (locale) => set({ locale }),
}));
