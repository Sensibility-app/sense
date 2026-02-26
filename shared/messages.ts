export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

// Rich content parts for tool results (and future: user messages)
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentPart[];
  is_error: boolean;
}
export interface CompactionBlock {
  type: "compaction";
  content: string;
}
export type Block = ThinkingBlock | TextBlock | ToolUseBlock | ToolResultBlock | CompactionBlock;
// Turn = one message in conversation (LLM native format + our metadata)
export interface Turn {
  id: string;
  timestamp: string;
  taskId: string;
  role: "user" | "assistant";
  content: string | Block[];
}

// Tool info for command suggestions
export interface ToolInfo {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
}

// Token tracking
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

// Server → Client
export type ServerMessage =
  | { type: "task_start"; taskId: string }
  | { type: "thinking_delta"; taskId: string; content: string }
  | { type: "text_delta"; taskId: string; content: string }
  | { type: "tool_use"; taskId: string; toolId: string; toolName: string; toolInput: unknown }
  | { type: "tool_result"; taskId: string; toolId: string; toolOutput: string | ContentPart[]; toolError: boolean }
  | { type: "turn_complete"; taskId: string }
  | { type: "token_usage"; usage: TokenUsage }
  | { type: "task_complete"; taskId: string }
  | { type: "system"; content: string; level: "info" | "error" | "success" }
  | { type: "session_info"; history: Turn[]; tokenUsage: TokenUsage; tools: ToolInfo[] }
  | { type: "reload_page"; reason: string };
