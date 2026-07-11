import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { applyPlatformToDocument, detectPlatform, detectPlatformSync, type Platform } from "./platform";
import "./form.css";

const PlatformContext = createContext<Platform>("macos");

export function usePlatform() {
  return useContext(PlatformContext);
}

export default function PlatformThemeProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>(() => {
    const initial = detectPlatformSync();
    applyPlatformToDocument(initial);
    return initial;
  });

  useEffect(() => {
    let mounted = true;
    detectPlatform().then((value) => {
      if (!mounted) return;
      setPlatform(value);
      applyPlatformToDocument(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}
