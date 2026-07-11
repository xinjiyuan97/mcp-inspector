import type { LlmConfig } from "../types";

export const LLM_PRESETS: LlmConfig[] = [
  { name: "GPT-4o", api_format: "open_ai", base_url: "https://api.openai.com/v1", api_key: "", model: "gpt-4o", temperature: 0.7 },
  { name: "DeepSeek-V3", api_format: "open_ai", base_url: "https://api.deepseek.com", api_key: "", model: "deepseek-chat", temperature: 0.7 },
  { name: "Qwen-Max", api_format: "open_ai", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", api_key: "", model: "qwen-max", temperature: 0.7 },
  { name: "GLM-4-Plus", api_format: "open_ai", base_url: "https://open.bigmodel.cn/api/paas/v4", api_key: "", model: "glm-4-plus", temperature: 0.7 },
  { name: "Claude-3.5-Sonnet", api_format: "anthropic", base_url: "https://api.anthropic.com/v1", api_key: "", model: "claude-3-5-sonnet-20241022", temperature: 0.7 },
  { name: "Kimi-K2", api_format: "open_ai", base_url: "https://api.moonshot.cn/v1", api_key: "", model: "moonshot-v1-auto", temperature: 0.7 },
];
