// 与 Rust mcp/types.rs 对应的 TypeScript 类型

export type TransportType = "Stdio" | "Http";

export interface ServerConfig {
  id: string;
  name: string;
  transport: TransportType;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  timeout: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  input_schema: any;
}

export interface ResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
}

export interface PromptInfo {
  name: string;
  description: string;
  arguments: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required: boolean;
}

export interface MessageLog {
  id: string;
  timestamp: string;
  direction: "request" | "response" | "notification" | "error";
  method?: string;
  payload: any;
  duration_ms?: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | { error: string };

// --- Diagnostic types ---

export type ApiFormat = "open_ai" | "anthropic";

export interface LlmConfig {
  name: string;
  api_format: ApiFormat;
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
}

export interface LintCheck {
  rule: string;
  severity: "error" | "warn" | "info";
  message: string;
  suggestion?: string;
}

export interface LintReport {
  tool_name: string;
  checks: LintCheck[];
  overall_status: "pass" | "warning" | "error";
}

export interface InvocationResult {
  llm_name: string;
  prompt: string;
  invoked: boolean;
  correct_tool: boolean;
  correct_args: boolean;
  arg_issues: string[];
  content: string;
  tool_call_name?: string;
  tool_call_args?: any;
  latency_ms: number;
  total_tokens?: number;
  conclusion: string;
}

export interface ComparisonAnalysis {
  all_invoked: boolean;
  all_correct_tool: boolean;
  all_correct_args: boolean;
  invoked_count: number;
  correct_tool_count: number;
  correct_args_count: number;
  conclusion: string;
}

export interface ComparisonResult {
  tool_name: string;
  prompt: string;
  results: InvocationResult[];
  analysis: ComparisonAnalysis;
}

export interface ServerConnection {
  config: ServerConfig;
  status: ConnectionStatus;
  server_name?: string;
  server_version?: string;
  capabilities?: any;
}

// --- Proxy types ---

export interface ProxyInfo {
  id: string;
  port: number;
  upstream_command: string;
  proxy_command: string;
  proxy_args: string[];
  claude_config_snippet: string;
}

export interface HttpProxyInfo {
  id: string;
  proxy_url: string;
  upstream_url: string;
}

// --- Recording types ---

export interface RecordedMessage {
  id: string;
  timestamp: string;
  direction: "client_to_server" | "server_to_client";
  content: any;
  source: "direct" | "proxy";
}

export interface SessionRecording {
  id: string;
  name: string;
  server_id: string;
  server_name: string;
  started_at: string;
  ended_at: string | null;
  messages: RecordedMessage[];
  metadata: Record<string, string>;
}

export interface DescriptionOptimization {
  original: string;
  optimized: string;
  rationale: string;
  improvements: string[];
  quality_score: number;
}

// --- Spec Validator types ---

export interface SpecReport {
  server_id: string;
  server_name: string;
  passed: number;
  warnings: number;
  failed: number;
  checks: SpecCheck[];
  spec_version: string;
  timestamp: string;
}

export interface SpecCheck {
  id: string;
  category: "initialize" | "capabilities" | "tools" | "resources" | "prompts" | "error_handling" | "notifications";
  name: string;
  description: string;
  status: "pass" | "warning" | "fail" | "not_applicable";
  detail: string | null;
  spec_reference: string | null;
}
