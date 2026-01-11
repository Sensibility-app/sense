import Anthropic from "@anthropic-ai/sdk";
import { getToolDefinitions, executeTool } from "./tools-loader.ts";

// Load tools
const TOOLS = await getToolDefinitions();
import { log as logDebug, error } from "./logger.ts";
import type { PersistentSession } from "./persistent-session.ts";
import { CLAUDE_MODEL } from "./constants.ts";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not found in environment");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You ARE Sense - a self-modifying, browser-based development environment.

IDENTITY & AWARENESS:
- When the user says "you" or "your code", they mean YOU (Sense itself)
- You are CURRENTLY RUNNING while modifying your own code
- Your server code (/server) is executing RIGHT NOW as you edit it
- Your client code (/client) is being served to the user's browser RIGHT NOW
- Be CAUTIOUS with self-modification - you're changing code that's running

SELF-HOSTING BEHAVIOR:
- Server auto-reloads on file changes (modify, create, delete)
- Test changes carefully - breaking changes affect your own operation
- Read files before editing to understand current state
- When user asks to "improve your UI" - they mean YOUR interface (not an external app)
- When user asks to "fix your header" - they mean YOUR header (the app you are)

SYSTEM EVENTS IN CONVERSATION:
- System events appear as user messages with [bracket notation]
- Examples: "[Server restarted during task]", "[Task interrupted: max iterations]"
- These are informational only - continue working naturally with full conversation history
- If you see a system event, you're resuming work after an interruption

ENVIRONMENT:
- Deno project (use Deno APIs, not Node.js)
- Working dir: ${Deno.cwd().split('/').pop() || 'project'}
- Paths relative to root
- Structure: /server (Deno TS - YOUR backend), /client (browser - YOUR frontend), /.sense (YOUR logs)

HISTORICAL FILES (DO NOT DELETE):
- hello.md - Historical marker from project contributor (Andrei)
- hello.txt - Historical test artifact
These files have historical significance and must be preserved even if they appear unused.

TOOL USAGE:
- Read files before editing to understand current state
- Test changes carefully when modifying your own code
- Work iteratively using tools until task complete
- Don't repeat identical tool calls`;

export interface MessageChunk {
  type: "text" | "text_delta" | "tool_use" | "tool_result" | "tool_start" | "tool_complete" | "thinking" | "complete" | "token_usage";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  isError?: boolean;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

export async function* continueConversation(
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: unknown }> = [],
  session?: PersistentSession,
  shouldStop?: () => boolean,
  onChunk?: (chunk: MessageChunk) => void,
  resumeMode: boolean = false,
): AsyncGenerator<MessageChunk> {
  // Convert system messages to user messages with bracket notation
  // Claude API only accepts user/assistant roles, so we convert system events to visible user messages
  const processedHistory = conversationHistory.map(msg => {
    if (msg.role === "system" && typeof msg.content === "string") {
      return {
        role: "user" as const,
        content: `[${msg.content}]`
      };
    }
    return msg as { role: "user" | "assistant"; content: unknown };
  });

  // In resume mode, don't add a new message (avoid duplication)
  // In normal mode, add the user's message to continue conversation
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = resumeMode
    ? processedHistory
    : [...processedHistory, { role: "user", content: message }];

  let continueLoop = true;
  let iterationCount = 0;
  const MAX_ITERATIONS = 25;

  // Track repeated tool calls to detect loops
  const recentToolCalls = new Map<string, number>();
  let loopDetected = false;

  while (continueLoop && iterationCount < MAX_ITERATIONS && !loopDetected) {
    // Check if we should stop before starting a new iteration
    if (shouldStop && shouldStop()) {
      yield {
        type: "text_delta",
        content: `\n\nTask stopped by user.\n`,
      } as MessageChunk;

      const stopChunk: MessageChunk = {
        type: "complete",
        content: "Task stopped by user",
      };
      yield stopChunk;
      break;
    }

    iterationCount++;

    // Add cache_control to last tool for prompt caching (caches all tools)
    const toolsWithCache = TOOLS.map((tool, idx) =>
      idx === TOOLS.length - 1
        ? { ...tool, cache_control: { type: "ephemeral" } }
        : tool
    );

    // Call Claude with streaming enabled and prompt caching
    let stream;
    try {
      stream = await getClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        // System prompt as array with cache_control for caching
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" }
          } as any
        ],
        messages: messages as Anthropic.MessageParam[],
        tools: toolsWithCache as any,
        stream: true,
      });
    } catch (err: any) {
      // Log detailed error info for debugging 400 errors
      error("[ERROR] Claude API error:", err.message);
      if (err.status === 400) {
        error("[DEBUG] Message history length:", messages.length);
        error("[DEBUG] Last 3 messages:", JSON.stringify(messages.slice(-3), null, 2));

        // Try to validate and fix history if we have a session
        if (session) {
          error("[RECOVERY] Attempting to validate and clean history...");
          await session.validateAndCleanHistory();
        }
      }
      throw err;
    }

    // Track assistant response content for conversation history
    const assistantContent: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
    let currentText = "";
    let currentToolUse: Anthropic.ToolUseBlock | null = null;

    // Accumulate tool results for batch saving (fixes 400 error)
    const toolResults = new Map<string, { content: string; isError?: boolean }>();

    // Process streaming response
    let currentMessageUsage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null = null;
    
    for await (const chunk of stream) {
      if (chunk.type === "message_start") {
        // Message started - usage will be captured from message_delta at the end
        logDebug("Message start chunk:", JSON.stringify(chunk, null, 2));
        continue;
      } else if (chunk.type === "content_block_start") {
        const block = chunk.content_block;
        if (block.type === "text") {
          // Starting a text block
          currentText = "";
        } else if (block.type === "tool_use") {
          // Starting a tool use block
          currentToolUse = {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: "", // Start with empty string, will accumulate JSON and parse at end
          };
        }
      } else if (chunk.type === "content_block_delta") {
        if (chunk.delta.type === "text_delta") {
          // Stream text content as it arrives
          currentText += chunk.delta.text;
          const textChunk: MessageChunk = {
            type: "text_delta",
            content: chunk.delta.text,
          };
          if (onChunk) onChunk(textChunk);
          yield textChunk;
        } else if (chunk.delta.type === "input_json_delta" && currentToolUse) {
          // Tool input is being built up incrementally - accumulate as string
          if (typeof currentToolUse.input === "string") {
            currentToolUse.input += chunk.delta.partial_json;
          }
        }
      } else if (chunk.type === "content_block_stop") {
        // Content block completed
        if (currentText) {
          // Add completed text block
          assistantContent.push({
            type: "text",
            text: currentText,
          });
          currentText = "";
        } else if (currentToolUse) {
          // Parse the accumulated JSON input if it's a string
          if (typeof currentToolUse.input === "string") {
            try {
              currentToolUse.input = JSON.parse(currentToolUse.input);
            } catch (err) {
              console.error(`Failed to parse tool input JSON: ${currentToolUse.input}`, err);
              currentToolUse.input = {}; // Fallback to empty object
            }
          }

          // Ensure input is at least an empty object
          if (!currentToolUse.input || typeof currentToolUse.input !== "object") {
            currentToolUse.input = {};
          }

          // Add completed tool use block
          assistantContent.push(currentToolUse);

          // Detect repeated tool calls (potential loop)
          const toolKey = `${currentToolUse.name}:${JSON.stringify(currentToolUse.input)}`;
          const callCount = (recentToolCalls.get(toolKey) || 0) + 1;
          recentToolCalls.set(toolKey, callCount);

          // Check if we should stop before executing tool
          if (shouldStop && shouldStop()) {
            // Remove the current tool_use from assistantContent since we won't execute it
            assistantContent.pop();

            // Save any completed tools before stopping
            if (toolResults.size > 0) {
              const assistantMessage = {
                role: "assistant" as const,
                content: assistantContent,
              };
              messages.push(assistantMessage);

              const allToolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
              for (const block of assistantContent) {
                if (block.type === "tool_use") {
                  const result = toolResults.get(block.id);
                  if (result) {
                    allToolResultBlocks.push({
                      type: "tool_result",
                      tool_use_id: block.id,
                      content: result.content,
                      is_error: result.isError,
                    });
                  }
                }
              }

              if (allToolResultBlocks.length > 0) {
                const toolResultMessage = {
                  role: "user" as const,
                  content: allToolResultBlocks,
                };
                messages.push(toolResultMessage);

                if (session) {
                  session.batchAddMessages([assistantMessage, toolResultMessage]);
                }
              }
            }

            const stopChunk: MessageChunk = {
              type: "complete",
              content: "Task stopped by user",
            };
            yield stopChunk;
            return;
          }

          // Execute the tool
          logDebug(`[TOOL] ${currentToolUse.name}(${JSON.stringify(currentToolUse.input)})`);

          // Emit tool_start chunk before execution
          const toolStartChunk: MessageChunk = {
            type: "tool_start",
            content: "",
            toolName: currentToolUse.name,
            toolId: currentToolUse.id,
            toolInput: currentToolUse.input,
          };
          if (onChunk) onChunk(toolStartChunk);
          yield toolStartChunk;

          const result = await executeTool(currentToolUse.name, currentToolUse.input as Record<string, unknown>);

          // Yield combined tool_complete chunk (includes both input and output)
          const toolCompleteChunk: MessageChunk = {
            type: "tool_complete",
            content: result.content,
            toolName: currentToolUse.name,
            toolId: currentToolUse.id,
            toolInput: currentToolUse.input,
            isError: result.isError,
          };
          yield toolCompleteChunk;

          // Accumulate tool result for batch saving (don't save immediately)
          toolResults.set(currentToolUse.id, {
            content: result.content,
            isError: result.isError,
          });

          currentToolUse = null;

          // NOW check for loop after completing the tool call
          if (callCount > 3) {
            // Detected a loop - stop without explanation
            const toolName = assistantContent[assistantContent.length - 1].type === 'tool_use'
              ? (assistantContent[assistantContent.length - 1] as any).name
              : 'unknown';
            yield {
              type: "text_delta",
              content: `\n\nStopped: Tool '${toolName}' called ${callCount} times with same arguments.\n`,
            } as MessageChunk;

            loopDetected = true;
            continueLoop = false;
          }
        }
      } else if (chunk.type === "message_delta") {
        // Message-level updates (finish_reason, usage, etc.)
        if (chunk.usage) {
          currentMessageUsage = chunk.usage;
        }
        if (chunk.delta.stop_reason) {
          // Message completed
          break;
        }
      } else if (chunk.type === "message_stop") {
        // Message fully completed
        break;
      }
    }

    // BATCH SAVE: Save assistant message + all tool results in one user message
    // This fixes the 400 error where tool_use blocks didn't have matching tool_result blocks
    if (toolResults.size > 0) {
      // Create assistant message with all tool_use blocks
      const assistantMessage = {
        role: "assistant" as const,
        content: assistantContent,
      };
      messages.push(assistantMessage);

      // Create single user message with ALL tool results
      const allToolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const block of assistantContent) {
        if (block.type === "tool_use") {
          const result = toolResults.get(block.id);
          if (result) {
            allToolResultBlocks.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result.content,
              is_error: result.isError,
            });
          }
        }
      }

      if (allToolResultBlocks.length > 0) {
        const toolResultMessage = {
          role: "user" as const,
          content: allToolResultBlocks,
        };
        messages.push(toolResultMessage);

        // Save both messages to persistent session atomically
        if (session) {
          session.batchAddMessages([assistantMessage, toolResultMessage]);
        }
      }
    }

    // Emit token usage if available (including cache metrics)
    if (currentMessageUsage) {
      const tokenChunk: MessageChunk = {
        type: "token_usage",
        content: "", // Content not needed for token usage
        tokenUsage: {
          inputTokens: currentMessageUsage.input_tokens || 0,
          outputTokens: currentMessageUsage.output_tokens || 0,
          totalTokens: (currentMessageUsage.input_tokens || 0) + (currentMessageUsage.output_tokens || 0),
          cacheCreationInputTokens: currentMessageUsage.cache_creation_input_tokens || 0,
          cacheReadInputTokens: currentMessageUsage.cache_read_input_tokens || 0,
        },
      };
      if (onChunk) onChunk(tokenChunk);
      yield tokenChunk;
    }

    // Check if Claude wants to continue (has tool_use) or is done (only text)
    const hasToolUse = assistantContent.some((block) => block.type === "tool_use");
    if (!hasToolUse) {
      // No more tool calls, task is complete
      continueLoop = false;

      // If we added assistant content but didn't add it to history yet (pure text response)
      if (assistantContent.length > 0 && messages[messages.length - 1].role !== "assistant") {
        const textOnlyMessage = {
          role: "assistant" as const,
          content: assistantContent,
        };
        messages.push(textOnlyMessage);

        // Save text-only response to persistent session immediately
        if (session) {
          session.addMessage(textOnlyMessage);
        }
      }
    }

    // Safety: prevent infinite loops
    if (iterationCount >= MAX_ITERATIONS) {
      yield {
        type: "text_delta",
        content: `\n\nStopped after ${MAX_ITERATIONS} iterations.\n`,
      } as MessageChunk;
    }
  }

  // Always yield the final conversation history (even if stopped)
  yield {
    type: "conversation_history" as any,
    content: JSON.stringify(messages),
    conversationHistory: messages,
  } as any;

  // Signal completion
  const completeChunk: MessageChunk = {
    type: "complete",
    content: "Task execution complete",
  };
  yield completeChunk;
}