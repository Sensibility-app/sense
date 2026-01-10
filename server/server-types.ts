/**
 * WebSocket message type definitions for client-server communication
 */

import type { DisplayMessage } from "./persistent-session.ts";

/**
 * Messages sent from client to server
 */
export type ClientMessage =
  | { type: "task"; content: string }
  | { type: "stop_task" }
  | { type: "archive_session" }
  | { type: "clear_session" }
  | { type: "ping" };

/**
 * Messages sent from server to client
 */
export type ServerMessage =
  // State updates (header only)
  | { type: "session_info"; messageCount: number; interruptedTask?: string; history: DisplayMessage[]; tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }; isTaskRunning?: boolean; contextSize?: { estimatedTokens: number; bytes: number } }
  | { type: "connection_status"; status: "connected" | "disconnected"; message?: string }
  | { type: "processing_status"; isProcessing: boolean; message?: string }
  | { type: "token_usage"; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; formatted: string }

  // Conversation messages (chat display)
  | { type: "user_message"; content: string }
  | { type: "assistant_response"; content?: string; streaming?: boolean }
  | { type: "text_delta"; content: string }
  | { type: "thinking"; content: string }

  // Tool use messages
  | { type: "tool_use"; toolName: string; toolId: string; toolInput?: unknown }
  | { type: "tool_start"; toolName: string; toolId: string; toolInput?: unknown }
  | { type: "tool_complete"; toolName: string; toolId: string; toolInput?: unknown; content: string; isError?: boolean }
  | { type: "tool_result"; toolId: string; content: string; isError: boolean }

  // System messages (small, minimal in chat)
  | { type: "system"; content: string; level?: "info" | "error" | "success" }
  | { type: "tool_activity"; toolName: string; status: "started" | "completed" | "error"; preview?: string; toolId?: string }

  // Task lifecycle
  | { type: "task_complete"; summary: string }

  // Heartbeat
  | { type: "pong" }

  // Hot reload
  | { type: "reload_page"; reason: string };

/**
 * Format token usage for display
 */
export function formatTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): string {
  return `${usage.totalTokens.toLocaleString()} tokens (${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out)`;
}
