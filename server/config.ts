import { join } from "@std/path";

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
  APP_NAME: Deno.env.get("APP_NAME") || "sense",
  MAX_ITERATIONS: 25,
  MAX_TOKENS: 32000,
  MAX_FILE_SIZE: 10000,
  SEARCH_RESULT_LIMIT: 100,
  SEARCH_CONTENT_LIMIT: 5000,
  EVAL_TIMEOUT_MS: 10000,
  TALK_TIMEOUT_MS: 60000,
  TOOL_RESULT_MAX_LENGTH: 20000,
};
