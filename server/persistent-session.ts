import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";
import { log, error } from "./logger.ts";

const SENSE_DIR = join(Deno.cwd(), ".sense");
const CURRENT_SESSION_PATH = join(SENSE_DIR, "current-session.json");

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: unknown;
}

export interface SessionData {
  id: string;
  created: string;
  lastActive: string;
  messages: ConversationMessage[];

  // Token usage tracking (persists across restarts)
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export class PersistentSession {
  private sessionId: string;
  private messages: ConversationMessage[] = [];

  // Token usage tracking
  private tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  private createdTime?: string;

  constructor() {
    this.sessionId = "current";
  }

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(SENSE_DIR, { recursive: true });

      if (await exists(CURRENT_SESSION_PATH)) {
        const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
        const sessionData: SessionData = JSON.parse(data);
        this.messages = sessionData.messages;
        this.tokenUsage = sessionData.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        this.sessionId = sessionData.id;
        this.createdTime = sessionData.created;

        await this.updateLastActive();

        log(`Loaded current session with ${this.messages.length} messages`);

        return true;
      }

      // New session
      this.createdTime = new Date().toISOString();
      await this.save(); // Immediate save for new session
      log(`Created new current session`);
      return false;
    } catch (err) {
      error(`Failed to load session:`, err);
      return false;
    }
  }

  // Save immediately - critical for self-modifying system that can restart anytime
  async save(): Promise<void> {
    try {
      const sessionData: SessionData = {
        id: this.sessionId,
        created: this.createdTime || new Date().toISOString(),
        lastActive: new Date().toISOString(),
        messages: this.messages,
        tokenUsage: this.tokenUsage,
      };

      await Deno.mkdir(SENSE_DIR, { recursive: true });
      await Deno.writeTextFile(CURRENT_SESSION_PATH, JSON.stringify(sessionData, null, 2));
    } catch (err) {
      error(`Failed to save session:`, err);
    }
  }

  private async updateLastActive(): Promise<void> {
    try {
      if (await exists(CURRENT_SESSION_PATH)) {
        const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
        const sessionData: SessionData = JSON.parse(data);
        sessionData.lastActive = new Date().toISOString();
        await Deno.writeTextFile(CURRENT_SESSION_PATH, JSON.stringify(sessionData, null, 2));
      }
    } catch {
      // Ignore
    }
  }

  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
    // Fire and forget - don't block on save
    this.save().catch((err) => error("Failed to save after addMessage:", err));
  }

  // Batch add multiple messages (useful for history loading)
  batchAddMessages(messages: ConversationMessage[]): void {
    this.messages.push(...messages);
    // Fire and forget - don't block on save
    this.save().catch((err) => error("Failed to save after batchAddMessages:", err));
  }

  getMessages(): ConversationMessage[] {
    return this.messages;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  private estimateTokenCount(content: unknown): number {
    const str = JSON.stringify(content);
    return Math.ceil(str.length / 4);
  }

  // Get total estimated token count for session
  getSessionTokenCount(): number {
    return this.messages.reduce((total, msg) => {
      return total + this.estimateTokenCount(msg.content);
    }, 0);
  }

  // Get session size info
  getSessionSizeInfo(): { messageCount: number; estimatedTokens: number; bytes: number } {
    const bytes = JSON.stringify(this.messages).length;
    const estimatedTokens = this.getSessionTokenCount();
    return {
      messageCount: this.messages.length,
      estimatedTokens,
      bytes,
    };
  }

  async clear(): Promise<void> {
    this.messages = [];
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.createdTime = new Date().toISOString();
    await this.save();
  }

  // ============================================================================
  // Task Resume Detection (derived from message history)
  // ============================================================================

  /**
   * Check if there's an incomplete task that needs resuming.
   * Derives the answer from the message history - no separate flag needed.
   *
   * A task needs resuming if:
   * - Last message is from user (except system messages like "[Task stopped]")
   * - Last message is from assistant with tool_use blocks (tools pending execution)
   */
  needsResume(): boolean {
    if (this.messages.length === 0) return false;

    const lastMessage = this.messages[this.messages.length - 1];

    // Case 1: User message (except system messages)
    if (lastMessage.role === "user") {
      // System messages are strings that start with "[" and end with "]"
      // e.g., "[Task stopped by user]", "[Resuming after server restart]"
      if (typeof lastMessage.content === "string") {
        const content = lastMessage.content;
        if (content.startsWith("[") && content.endsWith("]")) {
          return false; // System message, don't resume
        }
      }
      // Any other user message (including tool_results) needs a response
      return true;
    }

    // Case 2: Assistant message with pending tool_use
    if (lastMessage.role === "assistant" && Array.isArray(lastMessage.content)) {
      return lastMessage.content.some(
        (block: any) => block.type === "tool_use"
      );
    }

    // Case 3: Assistant text-only response = conversation complete
    return false;
  }

  /**
   * Validate and clean conversation history to ensure all tool_use blocks
   * have corresponding tool_result blocks. This fixes interrupted tasks.
   *
   * Returns the cleaned message array, truncating to the last valid state if needed.
   */
  async validateAndCleanHistory(): Promise<ConversationMessage[]> {
    const messages = [...this.messages];
    let modified = false;

    // Find unpaired tool_use blocks
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];

      // Skip non-assistant messages
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

      // Get all tool_use blocks in this message
      const toolUseBlocks = msg.content.filter((block: any) => block.type === "tool_use");
      if (toolUseBlocks.length === 0) continue;

      // Check next message for tool_results
      const nextMsg = messages[i + 1];
      if (nextMsg.role !== "user" || !Array.isArray(nextMsg.content)) {
        // No user message after tool_use = truncate here
        log(`⚠️  Found tool_use without following user message at index ${i}, truncating`);
        this.messages = messages.slice(0, i);
        await this.save();
        return this.messages;
      }

      const toolResultBlocks = nextMsg.content.filter((block: any) => block.type === "tool_result");
      const toolUseIds = toolUseBlocks.map((block: any) => block.id);
      const toolResultIds = toolResultBlocks.map((block: any) => block.tool_use_id);

      // Check if all tool_use blocks have corresponding tool_results
      const missingResults = toolUseIds.filter(id => !toolResultIds.includes(id));

      if (missingResults.length > 0) {
        log(`⚠️  Found ${missingResults.length} unpaired tool_use blocks at message ${i}`);
        log(`    Tool use IDs: ${toolUseIds.join(", ")}`);
        log(`    Tool result IDs: ${toolResultIds.join(", ")}`);
        log(`    Missing results for: ${missingResults.join(", ")}`);

        // Add synthetic error results for missing tool_results
        for (const missingId of missingResults) {
          const toolUseBlock = toolUseBlocks.find((block: any) => block.id === missingId);
          const toolName = toolUseBlock?.name || "unknown";

          log(`    Adding synthetic error result for ${toolName} (${missingId})`);

          nextMsg.content.push({
            type: "tool_result",
            tool_use_id: missingId,
            content: `[Tool execution interrupted - server restarted]`,
            is_error: true
          });
          modified = true;
        }
      }
    }

    // Save the cleaned history if modified
    if (modified) {
      this.messages = messages;
      await this.save();
      log("💾 Saved cleaned conversation history");
    }

    return this.messages;
  }

  // ============================================================================
  // Token Usage Tracking Methods
  // ============================================================================

  /**
   * Add token usage and persist immediately
   */
  addTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): void {
    this.tokenUsage.inputTokens += usage.inputTokens;
    this.tokenUsage.outputTokens += usage.outputTokens;
    this.tokenUsage.totalTokens += usage.totalTokens;
    // Fire-and-forget save (tokens are not critical for correctness)
    this.save().catch((err) => error("Failed to save after addTokenUsage:", err));
  }

  /**
   * Get current token usage
   */
  getTokenUsage() {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage (called when clearing session)
   */
  resetTokenUsage(): void {
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.save().catch((err) => error("Failed to save after resetTokenUsage:", err));
  }

  async delete(): Promise<void> {
    try {
      if (await exists(CURRENT_SESSION_PATH)) {
        await Deno.remove(CURRENT_SESSION_PATH);
        log(`Deleted current session`);
      }
    } catch (err) {
      error(`Failed to delete session:`, err);
    }
  }

  // Cleanup method to ensure final save before shutdown
  async shutdown(): Promise<void> {
    await this.save();
  }
}

// ============================================================================
// Session Formatting for Display
// ============================================================================

export interface DisplayMessage {
  type: "user" | "assistant" | "tool" | "thinking" | "system";
  content: string;
  timestamp?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  toolError?: boolean;
}

export function formatSessionHistory(messages: ConversationMessage[]): DisplayMessage[] {
  const displayMessages: DisplayMessage[] = [];
  const pendingToolCalls = new Map<string, DisplayMessage>(); // tool_use_id -> display message

  for (const message of messages) {
    if (message.role === "user") {
      // User message - extract the actual text content
      let content = "";
      if (typeof message.content === "string") {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        // Handle tool results and other structured content
        for (const item of message.content) {
          if (typeof item === "object" && item !== null) {
            if ("type" in item && item.type === "tool_result") {
              // Handle tool results in user messages (when tools respond)
              const toolResult = item as { tool_use_id: string; content: unknown; is_error?: boolean };
              const pendingTool = pendingToolCalls.get(toolResult.tool_use_id);
              if (pendingTool) {
                // Add result to the pending tool call and move it to display
                pendingTool.toolResult = typeof toolResult.content === "string"
                  ? toolResult.content
                  : JSON.stringify(toolResult.content);
                pendingTool.toolError = toolResult.is_error || false;
                displayMessages.push(pendingTool);
                pendingToolCalls.delete(toolResult.tool_use_id);
              }
            } else if ("text" in item) {
              content += (item as { text: string }).text;
            }
          } else if (typeof item === "string") {
            content += item;
          }
        }
      }

      if (content.trim()) {
        displayMessages.push({
          type: "user",
          content: content.trim()
        });
      }
    } else if (message.role === "system") {
      // System message - display as system message in UI
      if (typeof message.content === "string") {
        displayMessages.push({
          type: "system",
          content: message.content
        });
      }
    } else if (message.role === "assistant") {
      // Assistant message - extract text and tool use
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (typeof block === "object" && block !== null) {
            if ("type" in block) {
              if (block.type === "text" && "text" in block) {
                // Text response from Claude
                const text = (block as { text: string }).text.trim();
                if (text) {
                  displayMessages.push({
                    type: "assistant",
                    content: text
                  });
                }
              } else if (block.type === "tool_use" && "name" in block && "id" in block) {
                // Tool use - store it pending result matching
                const toolBlock = block as { id: string; name: string; input?: unknown };
                const toolMessage: DisplayMessage = {
                  type: "tool",
                  content: `Using tool: ${toolBlock.name}`,
                  toolName: toolBlock.name,
                  toolInput: toolBlock.input
                };
                pendingToolCalls.set(toolBlock.id, toolMessage);
              }
            }
          }
        }
      } else if (typeof message.content === "string") {
        // Simple text content
        displayMessages.push({
          type: "assistant",
          content: message.content
        });
      }
    }
  }

  // Add any remaining tool calls without results (shouldn't happen in normal flow)
  for (const toolMessage of pendingToolCalls.values()) {
    displayMessages.push(toolMessage);
  }

  return displayMessages;
}

export function getLastUserMessage(messages: ConversationMessage[]): string | null {
  // Find the last user message (most recent task)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") {
      if (typeof message.content === "string") {
        return message.content;
      } else if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (typeof item === "string") {
            return item;
          } else if (typeof item === "object" && item !== null && "text" in item) {
            return (item as { text: string }).text;
          }
        }
      }
    }
  }
  return null;
}

// Archive current session (create timestamped backup)
export async function archiveCurrentSession(): Promise<void> {
  try {
    if (await exists(CURRENT_SESSION_PATH)) {
      const archiveDir = join(SENSE_DIR, "archives");
      await Deno.mkdir(archiveDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const archivePath = join(archiveDir, `session_${timestamp}.json`);

      const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
      await Deno.writeTextFile(archivePath, data);

      log(`Archived current session to ${archivePath}`);
    }
  } catch (err) {
    error("Failed to archive session:", err);
  }
}
