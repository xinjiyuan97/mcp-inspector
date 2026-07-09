import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServerStore } from "./store/serverStore";
import Sidebar from "./components/Sidebar";
import MainPanel from "./components/MainPanel";
import MessageLog from "./components/MessageLog";

export default function App() {
  const addMessage = useServerStore((s) => s.addMessage);

  useEffect(() => {
    // 监听后端推送的 MCP 消息
    const unlisten = listen<any>("mcp_message", (event) => {
      addMessage(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addMessage]);

  return (
    <div className="flex h-screen w-screen bg-neutral-900 text-neutral-100">
      {/* 左栏：服务器列表 */}
      <div className="w-64 flex-shrink-0 border-r border-neutral-700">
        <Sidebar />
      </div>

      {/* 中栏：工具/资源/Prompt 面板 */}
      <div className="flex-1 flex flex-col min-w-0">
        <MainPanel />
      </div>

      {/* 右栏：消息日志 */}
      <div className="w-96 flex-shrink-0 border-l border-neutral-700">
        <MessageLog />
      </div>
    </div>
  );
}
