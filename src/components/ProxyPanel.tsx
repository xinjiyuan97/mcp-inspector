import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Radio, Play, Square, Copy, Check, Loader2, ArrowRight,
  ArrowLeft, Globe, Terminal,
} from "lucide-react";
import { clsx } from "clsx";
import type { ProxyInfo, HttpProxyInfo, MessageLog, ServerConfig } from "../types";
import JsonViewer from "./JsonViewer";
import { formatMcpServerEntry, proxyEntryName } from "../utils/proxyConfig";

type ProxyTab = "stdio" | "http";

export default function ProxyPanel() {
  const [tab, setTab] = useState<ProxyTab>("stdio");

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex gap-1 p-2 border-b border-neutral-700">
        <button
          onClick={() => setTab("stdio")}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium",
            tab === "stdio" ? "bg-blue-600 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
          )}
        >
          <Terminal size={14} />
          stdio 代理
        </button>
        <button
          onClick={() => setTab("http")}
          className={clsx(
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium",
            tab === "http" ? "bg-blue-600 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
          )}
        >
          <Globe size={14} />
          HTTP 代理
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === "stdio" ? <StdioProxyView /> : <HttpProxyView />}
      </div>
    </div>
  );
}

// =========================================================================
// stdio 代理
// =========================================================================

function StdioProxyView() {
  const [proxies, setProxies] = useState<ProxyInfo[]>([]);
  const [command, setCommand] = useState("npx");
  const [args, setArgs] = useState("-y @modelcontextprotocol/server-filesystem /tmp");
  const [env, setEnv] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, MessageLog[]>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    invoke<ProxyInfo[]>("list_stdio_proxies").then(setProxies).catch(() => {});
  }, []);

  const handleStart = async () => {
    setLoading(true);
    try {
      const config: ServerConfig = {
        id: crypto.randomUUID(),
        name: "proxy-target",
        transport: "Stdio",
        command,
        args: args.split(/\s+/).filter(Boolean),
        env: env ? Object.fromEntries(env.split("\n").filter(l => l.includes("=")).map(l => {
          const [k, ...v] = l.split("=");
          return [k.trim(), v.join("=").trim()];
        })) : {},
        url: undefined,
        headers: {},
        timeout: 30,
      };
      const info = await invoke<ProxyInfo>("start_stdio_proxy", { config });
      setProxies([...proxies, info]);

      // 监听消息事件
      const unlisten = await listen<MessageLog>(`proxy_message:${info.id}`, (e) => {
        setMessages(prev => ({
          ...prev,
          [info.id]: [...(prev[info.id] || []), e.payload],
        }));
      });
      // 存储 unlisten 函数（简化处理，实际应在 cleanup 中调用）
      (window as any)[`unlisten_${info.id}`] = unlisten;
    } catch (e) {
      alert(`启动代理失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await invoke("stop_stdio_proxy", { id });
      setProxies(proxies.filter(p => p.id !== id));
      const unlisten = (window as any)[`unlisten_${id}`];
      if (unlisten) unlisten();
    } catch (e) {
      alert(`停止失败: ${e}`);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* 启动新代理 */}
      <div className="space-y-2 p-3 bg-neutral-800 rounded-lg">
        <div className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <Radio size={14} /> 启动 stdio MITM 代理
        </div>
        <div>
          <label className="text-xs text-neutral-500">MCP Server 命令</label>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="w-full px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white"
            placeholder="npx / node / python ..."
          />
        </div>
        <div>
          <label className="text-xs text-neutral-500">参数（空格分隔）</label>
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            className="w-full px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white"
          />
        </div>
        <div>
          <label className="text-xs text-neutral-500">环境变量（每行 KEY=VALUE）</label>
          <textarea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            rows={2}
            className="w-full px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white font-mono"
            placeholder="API_KEY=xxx"
          />
        </div>
        <button
          onClick={handleStart}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white text-sm font-medium"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          启动代理
        </button>
      </div>

      {/* 活跃代理列表 */}
      {proxies.map((proxy) => (
        <div key={proxy.id} className="border border-neutral-700 rounded-lg overflow-hidden">
          {/* 代理信息 */}
          <div className="p-3 bg-neutral-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium text-neutral-200">
                  代理端口 {proxy.port}
                </span>
              </div>
              <button
                onClick={() => handleStop(proxy.id)}
                className="flex items-center gap-1 px-2 py-1 bg-red-700/50 hover:bg-red-700 rounded text-xs text-red-300"
              >
                <Square size={12} /> 停止
              </button>
            </div>

            {/* Claude Desktop 配置 */}
            <div>
              <div className="text-xs text-neutral-500 mb-1">配置到 Claude Desktop (复制到 mcpServers 中):</div>
              <div className="relative min-w-0">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-900 p-2 pr-10 text-xs leading-relaxed text-green-400 font-mono">
                  {formatMcpServerEntry(proxyEntryName(proxy.port), proxy.claude_config_snippet)}
                </pre>
                <button
                  onClick={() =>
                    copyToClipboard(
                      formatMcpServerEntry(proxyEntryName(proxy.port), proxy.claude_config_snippet),
                      proxy.id,
                    )
                  }
                  className="absolute top-1 right-1 rounded bg-neutral-700 p-1 hover:bg-neutral-600"
                >
                  {copied === proxy.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-neutral-400" />}
                </button>
              </div>
            </div>

            <div className="text-xs text-neutral-500">
              上游: <span className="text-neutral-400 font-mono">{proxy.upstream_command}</span>
            </div>
          </div>

          {/* 拦截的消息 */}
          <div className="p-2 max-h-64 overflow-y-auto">
            <div className="text-xs text-neutral-500 mb-1">
              拦截消息 ({messages[proxy.id]?.length || 0})
            </div>
            {(messages[proxy.id] || []).map((msg, i) => (
              <MessageRow key={i} msg={msg} />
            ))}
            {(!messages[proxy.id] || messages[proxy.id].length === 0) && (
              <div className="text-xs text-neutral-600 py-4 text-center">
                等待 Claude Desktop 连接...
              </div>
            )}
          </div>
        </div>
      ))}

      {proxies.length === 0 && (
        <div className="flex flex-col items-center justify-center text-neutral-500 gap-2 py-8">
          <Radio size={32} className="opacity-20" />
          <span className="text-sm">启动代理后，将生成的配置添加到 Claude Desktop</span>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// HTTP 代理
// =========================================================================

function HttpProxyView() {
  const [proxies, setProxies] = useState<HttpProxyInfo[]>([]);
  const [upstreamUrl, setUpstreamUrl] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Record<string, MessageLog[]>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    invoke<HttpProxyInfo[]>("list_http_proxies").then(setProxies).catch(() => {});
  }, []);

  const handleStart = async () => {
    if (!upstreamUrl) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (authHeader) headers["Authorization"] = authHeader;
      const info = await invoke<HttpProxyInfo>("start_http_proxy", {
        upstreamUrl,
        headers,
      });
      setProxies([...proxies, info]);

      const unlisten = await listen<MessageLog>(`proxy_message:${info.id}`, (e) => {
        setMessages(prev => ({
          ...prev,
          [info.id]: [...(prev[info.id] || []), e.payload],
        }));
      });
      (window as any)[`unlisten_http_${info.id}`] = unlisten;
    } catch (e) {
      alert(`启动 HTTP 代理失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await invoke("stop_http_proxy", { id });
      setProxies(proxies.filter(p => p.id !== id));
    } catch (e) {
      alert(`停止失败: ${e}`);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 p-3 bg-neutral-800 rounded-lg">
        <div className="text-sm font-medium text-neutral-300 flex items-center gap-2">
          <Globe size={14} /> 启动 HTTP MITM 代理
        </div>
        <div>
          <label className="text-xs text-neutral-500">上游 MCP Server URL</label>
          <input
            value={upstreamUrl}
            onChange={(e) => setUpstreamUrl(e.target.value)}
            className="w-full px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white"
            placeholder="https://remote-mcp-server.example.com/sse"
          />
        </div>
        <div>
          <label className="text-xs text-neutral-500">Authorization 头（可选）</label>
          <input
            value={authHeader}
            onChange={(e) => setAuthHeader(e.target.value)}
            className="w-full px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white font-mono"
            placeholder="Bearer sk-..."
          />
        </div>
        <button
          onClick={handleStart}
          disabled={loading || !upstreamUrl}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white text-sm font-medium"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          启动代理
        </button>
      </div>

      {proxies.map((proxy) => (
        <div key={proxy.id} className="border border-neutral-700 rounded-lg overflow-hidden">
          <div className="p-3 bg-neutral-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium text-neutral-200">HTTP 代理</span>
              </div>
              <button
                onClick={() => handleStop(proxy.id)}
                className="flex items-center gap-1 px-2 py-1 bg-red-700/50 hover:bg-red-700 rounded text-xs text-red-300"
              >
                <Square size={12} /> 停止
              </button>
            </div>

            <div>
              <div className="text-xs text-neutral-500 mb-1">将 Claude Desktop / Cursor 的 MCP URL 指向:</div>
              <div className="relative min-w-0">
                <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-neutral-900 p-2 pr-10 text-xs leading-relaxed text-green-400 font-mono">
                  {proxy.proxy_url}
                </pre>
                <button
                  onClick={() => copyToClipboard(proxy.proxy_url, proxy.id)}
                  className="absolute top-1 right-1 p-1 bg-neutral-700 rounded hover:bg-neutral-600"
                >
                  {copied === proxy.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-neutral-400" />}
                </button>
              </div>
            </div>

            <div className="text-xs text-neutral-500">
              上游: <span className="text-neutral-400 font-mono">{proxy.upstream_url}</span>
            </div>
          </div>

          <div className="p-2 max-h-64 overflow-y-auto">
            <div className="text-xs text-neutral-500 mb-1">
              拦截消息 ({messages[proxy.id]?.length || 0})
            </div>
            {(messages[proxy.id] || []).map((msg, i) => (
              <MessageRow key={i} msg={msg} />
            ))}
            {(!messages[proxy.id] || messages[proxy.id].length === 0) && (
              <div className="text-xs text-neutral-600 py-4 text-center">
                等待客户端连接...
              </div>
            )}
          </div>
        </div>
      ))}

      {proxies.length === 0 && (
        <div className="flex flex-col items-center justify-center text-neutral-500 gap-2 py-8">
          <Globe size={32} className="opacity-20" />
          <span className="text-sm">启动代理后，将客户端 URL 指向本地代理地址</span>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 消息行组件
// =========================================================================

function MessageRow({ msg }: { msg: MessageLog }) {
  const [expanded, setExpanded] = useState(false);

  const icon = msg.direction === "request" ? <ArrowRight size={12} className="text-blue-400" /> :
               msg.direction === "response" ? <ArrowLeft size={12} className="text-green-400" /> :
               msg.direction === "notification" ? <ArrowRight size={12} className="text-yellow-400" /> :
               <ArrowLeft size={12} className="text-red-400" />;

  const label = msg.direction === "request" ? "→ REQ" :
                msg.direction === "response" ? "← RES" :
                msg.direction === "notification" ? "→ NOTIF" :
                "← ERR";

  return (
    <div className="border-b border-neutral-800 py-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        {icon}
        <span className="text-xs font-mono text-neutral-400 w-12">{label}</span>
        {msg.method && <span className="text-xs font-mono text-blue-400">{msg.method}</span>}
      </button>
      {expanded && (
        <div className="mt-1 ml-6">
          <JsonViewer value={msg.payload} maxHeight="300px" />
        </div>
      )}
    </div>
  );
}
