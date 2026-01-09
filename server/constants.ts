// Server configuration constants

// Connection and networking
export const PORT = 8080;
export const SERVER_RESTART_WINDOW_MS = 10000; // Time window to detect server restart (10 seconds)

// Heartbeat and reconnection
export const HEARTBEAT_INTERVAL_MS = 30000; // Send ping every 30 seconds
export const HEARTBEAT_TIMEOUT_MS = 5000; // Wait 5 seconds for pong response
export const RECONNECT_DELAY_MS = 2000; // Wait 2 seconds before reconnecting
export const MAX_RECONNECT_ATTEMPTS = 10; // Maximum reconnection attempts

// Tool execution limits
export const MAX_FILE_SIZE_CHARS = 10000; // Maximum characters to read from a file
export const MAX_DIRECTORY_ENTRIES = 500; // Maximum directory entries to list
export const COMMAND_OUTPUT_LIMIT_CHARS = 5000; // Maximum command output characters
export const SEARCH_RESULT_LIMIT = 100; // Maximum search results to return
export const SEARCH_CONTENT_LIMIT = 5000; // Maximum search content characters

// Session management
export const SESSION_SAVE_DEBOUNCE_MS = 500; // Debounce session saves (500ms window)
export const SESSION_DIR = ".sense/sessions";

// Task execution
export const MAX_TASK_ITERATIONS = 25; // Maximum Claude iterations per task
export const COMMAND_TIMEOUT_MS = 30000; // Command execution timeout (30 seconds)

// Claude API
export const CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const CLAUDE_MAX_TOKENS = 8192;
