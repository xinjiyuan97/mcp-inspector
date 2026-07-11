import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServerStore } from "./store/serverStore";
import Sidebar from "./components/Sidebar";
import MainPanel from "./components/MainPanel";
import MessageLog from "./components/MessageLog";
import ResizableColumns from "./components/ResizableColumns";

export default function App() {
  const addMessage = useServerStore((s) => s.addMessage);
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    setRuntimeReady(inTauri);
  }, []);

  useEffect(() => {
    const unlisten = listen<any>("mcp_message", (event) => {
      addMessage(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addMessage]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-neutral-900 text-neutral-100">
      {runtimeReady === false && (
        <div className="fixed top-0 inset-x-0 z-50 bg-red-900/90 text-red-100 text-sm px-4 py-2 text-center">
          当前在浏览器模式运行，无法连接 MCP。请使用 <code className="mx-1">pnpm tauri dev</code> 启动桌面应用。
        </div>
      )}
      <ResizableColumns
        left={<Sidebar />}
        center={<MainPanel />}
        right={<MessageLog />}
      />
    </div>
  );
}
