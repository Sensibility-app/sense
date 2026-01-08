import type { ConversationMessage } from "./persistent-session.ts";

export interface DisplayMessage {
  type: "user" | "assistant" | "tool" | "thinking";
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