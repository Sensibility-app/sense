import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, executeTool } from "./tools-mcp.ts";
import { log as logDebug } from "./logger.ts";
import type { PersistentSession } from "./persistent-session.ts";

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

const SYSTEM_PROMPT = `You are Claude Code, an AI assistant integrated into a browser-based development environment called Sense.

You have access to tools that allow you to interact with the filesystem and execute commands. Use these tools to complete the user's requests.

IMPORTANT CONTEXT:
- This is a Deno project (use Deno APIs, not Node.js)
- Working directory: ${Deno.cwd()}
- All file paths are relative to the project root
- You can read files, write files, list directories, execute commands, and search for patterns
- When modifying files, always read them first to understand the current content
- Be proactive: if you need information, use tools to get it
- Continue using tools until the task is complete

FILE EDITING BEST PRACTICES:
- PREFER edit_file_range for multi-line changes (most reliable, works even after auto-formatting)
- Use edit_file for small, precise single-line changes (requires exact string match)
- Use create_file only for brand new files (fails if file exists)
- Use read_file_range to read specific line ranges from large files

PROJECT SETUP:
- Server code in /server (TypeScript for Deno)
- Client code in /client (HTML/CSS/JS for browser)
- Session logs in /.sense/sessions
- This is a self-hosting system that should be able to modify itself

SELF-HOSTING CAPABILITY:
- The server runs in watch mode and auto-reloads when files change
- After modifying server code, use reload_server tool to apply changes immediately
- You can modify your own tools, handlers, and system prompts
- Client-side changes (HTML/CSS/JS) take effect on browser refresh

EXPLORATION STRATEGY:
- When exploring the codebase, progressively drill down into subdirectories
- If you call list_directory on ".", you'll see directories like "client/", "server/"
- To explore further, call list_directory("client") or list_directory("server")
- NEVER call the same tool with the same arguments repeatedly - if you're not getting what you need, try a different approach
- Use search_files or read_file to examine specific files once you've located them

Your goal is to complete tasks autonomously by using the available tools iteratively until the job is done.`;

export interface MessageChunk {
  type: "text" | "text_delta" | "tool_use" | "tool_result" | "thinking" | "complete" | "token_usage";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  isError?: boolean;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export async function* executeTaskWithClaude(
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: unknown }> = [],
  session?: PersistentSession,
  shouldStop?: () => boolean,
  onChunk?: (chunk: MessageChunk) => void,
): AsyncGenerator<MessageChunk> {
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...conversationHistory,
    { role: "user", content: message },
  ];

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
        content: `\n\n⚠️ Task stopped by user.\n`,
      } as MessageChunk;

      const stopChunk: MessageChunk = {
        type: "complete",
        content: "Task stopped by user",
      };
      yield stopChunk;
      break;
    }

    iterationCount++;

    // Call Claude with streaming enabled
    const stream = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages as Anthropic.MessageParam[],
      tools: TOOLS as Anthropic.Tool[],
      stream: true,
    });

    // Track assistant response content for conversation history
    const assistantContent: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
    let currentText = "";
    let currentToolUse: Anthropic.ToolUseBlock | null = null;

    // Process streaming response
    // Process streaming response
    let currentMessageUsage: { input_tokens?: number; output_tokens?: number } | null = null;
    
    for await (const chunk of stream) {
      if (chunk.type === "message_start") {
        // Message started - capture usage information if available
        console.log("Message start chunk:", JSON.stringify(chunk, null, 2));
        if (chunk.message && chunk.message.usage) {
          currentMessageUsage = chunk.message.usage;
          console.log("Captured message usage:", currentMessageUsage);
        }
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

          // Emit tool use
          const toolChunk: MessageChunk = {
            type: "tool_use",
            content: `Using tool: ${currentToolUse.name}`,
            toolName: currentToolUse.name,
            toolInput: currentToolUse.input,
            toolId: currentToolUse.id,
          };
          yield toolChunk;

          // Detect repeated tool calls (potential loop)
          const toolKey = `${currentToolUse.name}:${JSON.stringify(currentToolUse.input)}`;
          const callCount = (recentToolCalls.get(toolKey) || 0) + 1;
          recentToolCalls.set(toolKey, callCount);

          // Check if we should stop before executing tool
          if (shouldStop && shouldStop()) {
            const stopChunk: MessageChunk = {
              type: "complete",
              content: "Task stopped by user",
            };
            yield stopChunk;
            return;
          }

          // Execute the tool
          logDebug(`[TOOL] ${currentToolUse.name}(${JSON.stringify(currentToolUse.input)})`);
          const result = await executeTool(currentToolUse.name, currentToolUse.input as Record<string, unknown>);

          // Emit tool result
          const resultChunk: MessageChunk = {
            type: "tool_result",
            content: result.content,
            isError: result.isError,
          };
          yield resultChunk;

          // Add tool result to messages for next iteration
          const assistantMessage = {
            role: "assistant" as const,
            content: assistantContent,
          };
          messages.push(assistantMessage);

          const toolResultMessage = {
            role: "user" as const,
            content: [
              {
                type: "tool_result",
                tool_use_id: currentToolUse.id,
                content: result.content,
                is_error: result.isError,
              },
            ] as Anthropic.ToolResultBlockParam[],
          };
          messages.push(toolResultMessage);

          // CRITICAL: Save to persistent session immediately
          // This ensures conversation history survives server reloads
          if (session) {
            session.addMessage(assistantMessage);
            session.addMessage(toolResultMessage);
            // Note: addMessage calls save() internally
          }

          currentToolUse = null;

          // NOW check for loop after completing the tool call
          if (callCount > 3) {
            // Detected a loop - mark task as interrupted
            if (session) {
              session.interruptTask("loop_detected", iterationCount, false); // Can't auto-resume loops
            }

            // Detected a loop - ask Claude to explain
            yield {
              type: "text_delta",
              content: `\n\n⚠️ Detected repeated tool call loop: ${assistantContent[assistantContent.length - 1].type === 'tool_use' ? (assistantContent[assistantContent.length - 1] as any).name : 'unknown'} called ${callCount} times with same arguments.\n\n`,
            } as MessageChunk;

            // Ask Claude to explain what happened
            messages.push({
              role: "user",
              content: `You appear to be stuck in a loop, repeatedly calling the same tool with the same arguments. Before we stop, please briefly explain:

1. What were you trying to accomplish?
2. Why did you keep calling the same tool?
3. What information were you looking for that you didn't receive?

Please keep your explanation concise (2-3 sentences).`,
            });

            // Get Claude's explanation
            const explanationStream = await getClient().messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 500,
              system: SYSTEM_PROMPT,
              messages: messages as Anthropic.MessageParam[],
              stream: true,
            });

            yield {
              type: "text_delta",
              content: "**Loop Analysis:**\n",
            } as MessageChunk;

            let explanationText = "";
            for await (const chunk of explanationStream) {
              if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                explanationText += chunk.delta.text;
                yield {
                  type: "text_delta",
                  content: chunk.delta.text,
                } as MessageChunk;
              }
            }

            // Save explanation to conversation
            messages.push({
              role: "assistant",
              content: [{ type: "text", text: explanationText }],
            });

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

    // Emit token usage if available
    if (currentMessageUsage) {
      const tokenChunk: MessageChunk = {
        type: "token_usage",
        content: "", // Content not needed for token usage
        tokenUsage: {
          inputTokens: currentMessageUsage.input_tokens || 0,
          outputTokens: currentMessageUsage.output_tokens || 0,
          totalTokens: (currentMessageUsage.input_tokens || 0) + (currentMessageUsage.output_tokens || 0),
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
      // Mark task as interrupted (can be resumed)
      if (session) {
        session.interruptTask("max_iterations", iterationCount, true);
      }

      yield {
        type: "text_delta",
        content: `\n\n⚠️ Stopped after ${MAX_ITERATIONS} iterations to prevent infinite loop.\n\n`,
      } as MessageChunk;

      // Ask Claude to explain what it was trying to do
      messages.push({
        role: "user",
        content: `You've reached the maximum iteration limit (${MAX_ITERATIONS}). Please briefly explain what you were trying to accomplish and why it took so many iterations. Keep it concise (2-3 sentences).`,
      });

      // Get Claude's explanation
      const explanationStream = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: messages as Anthropic.MessageParam[],
        stream: true,
      });

      yield {
        type: "text_delta",
        content: "**Iteration Limit Analysis:**\n",
      } as MessageChunk;

      let explanationText = "";
      for await (const chunk of explanationStream) {
        if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
          explanationText += chunk.delta.text;
          yield {
            type: "text_delta",
            content: chunk.delta.text,
          } as MessageChunk;
        }
      }

      // Save explanation to conversation
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: explanationText }],
      });
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