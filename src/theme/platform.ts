export type Platform = "macos" | "windows" | "linux";

export function normalizePlatform(value: string): Platform {
  if (value === "macos" || value === "ios") return "macos";
  if (value === "windows") return "windows";
  return "linux";
}

export function detectPlatformSync(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  if (ua.includes("mac") || platform.includes("mac")) return "macos";
  if (ua.includes("win") || platform.includes("win")) return "windows";
  return "linux";
}

export async function detectPlatform(): Promise<Platform> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { type } = await import("@tauri-apps/plugin-os");
      return normalizePlatform(type());
    } catch {
      // fall through to browser heuristics
    }
  }

  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac") || navigator.platform.toLowerCase().includes("mac")) {
    return "macos";
  }
  if (ua.includes("win") || navigator.platform.toLowerCase().includes("win")) {
    return "windows";
  }
  return "linux";
}

export function applyPlatformToDocument(platform: Platform) {
  document.documentElement.dataset.platform = platform;
}
