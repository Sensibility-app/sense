// Server configuration constants

// Tool execution limits
export const MAX_FILE_SIZE_CHARS = 10000; // Maximum characters to read from a file
export const MAX_DIRECTORY_ENTRIES = 500; // Maximum directory entries to list
export const COMMAND_OUTPUT_LIMIT_CHARS = 5000; // Maximum command output characters
export const SEARCH_RESULT_LIMIT = 100; // Maximum search results to return
export const SEARCH_CONTENT_LIMIT = 5000; // Maximum search content characters

// Session management
export const SESSION_DIR = ".sense/sessions";

// Task execution
export const MAX_TASK_ITERATIONS = 25; // Maximum Claude iterations per task
export const COMMAND_TIMEOUT_MS = 30000; // Command execution timeout (30 seconds)

// Claude API
export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
