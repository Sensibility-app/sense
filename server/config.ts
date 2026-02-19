import { join } from "jsr:@std/path@^1.0.0";

const BASE_DIR = Deno.cwd();

export const PATHS = {
  BASE: BASE_DIR,
  SESSIONS_DIR: join(BASE_DIR, "sessions"),
  LOG_FILE: join(BASE_DIR, "sessions", "server.log"),
  CURRENT_SESSION: join(BASE_DIR, "sessions", "current-session.json"),
  ARCHIVES_DIR: join(BASE_DIR, "sessions", "archives"),
  TOOLS_DIR: join(BASE_DIR, "server", "tools"),
} as const;

export const CONFIG = {
  PORT: parseInt(Deno.env.get("PORT") || "8080"),
  CLAUDE_MODEL: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-5-20250929",
  ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
  LLM_PROXY_URL: Deno.env.get("LLM_PROXY_URL"),
  MAX_ITERATIONS: 25,
  MAX_TOKENS: 16000,
  MAX_FILE_SIZE: 10000,
  SEARCH_RESULT_LIMIT: 100,
  SEARCH_CONTENT_LIMIT: 5000,
  EVAL_TIMEOUT_MS: 10000,
  SESSION_INFO_DELAY_MS: 100,
  MAX_WEBSOCKET_CONNECTIONS: 10,
  WEBSOCKET_PING_INTERVAL_MS: 30000,
  WEBSOCKET_PONG_TIMEOUT_MS: 10000,
};
