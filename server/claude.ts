import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, executeTool } from "./tools-mcp.ts";

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

PROJECT SETUP:
- Server code in /server (TypeScript for Deno)
- Client code in /client (HTML/CSS/JS for browser)
- Session logs in /.sense/sessions
- This is a self-hosting system that should be able to modify itself

Your goal is to complete tasks autonomously by using the available tools iteratively until the job is done.`;

export interface MessageChunk {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "complete";
  content: string;
  toolName?: string;
  toolInput?: unknown;
  isError?: boolean;
}

export async function* executeTaskWithClaude(
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: unknown }> = [],
  onChunk?: (chunk: MessageChunk) => void,
): AsyncGenerator<MessageChunk> {
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...conversationHistory,
    { role: "user", content: message },
  ];

  let continueLoop = true;
  let iterationCount = 0;
  const MAX_ITERATIONS = 25;

  while (continueLoop && iterationCount < MAX_ITERATIONS) {
    iterationCount++;

    // Call Claude with tools
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: messages as Anthropic.MessageParam[],
      tools: TOOLS as Anthropic.Tool[],
    });

    // Track assistant response content for conversation history
    const assistantContent: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];

    // Process response content
    for (const block of response.content) {
      if (block.type === "text") {
        assistantContent.push(block);
        const chunk: MessageChunk = { type: "text", content: block.text };
        if (onChunk) onChunk(chunk);
        yield chunk;
      } else if (block.type === "tool_use") {
        assistantContent.push(block);

        // Emit tool use
        const toolChunk: MessageChunk = {
          type: "tool_use",
          content: `Using tool: ${block.name}`,
          toolName: block.name,
          toolInput: block.input,
        };
        if (onChunk) onChunk(toolChunk);
        yield toolChunk;

        // Execute the tool
        const result = await executeTool(block.name, block.input as Record<string, unknown>);

        // Emit tool result
        const resultChunk: MessageChunk = {
          type: "tool_result",
          content: result.content,
          isError: result.isError,
        };
        if (onChunk) onChunk(resultChunk);
        yield resultChunk;

        // Add tool result to messages for next iteration
        messages.push({
          role: "assistant",
          content: assistantContent,
        });

        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: block.id,
              content: result.content,
              is_error: result.isError,
            },
          ] as Anthropic.ToolResultBlockParam[],
        });
      }
    }

    // Check if Claude wants to continue (has tool_use) or is done (only text)
    const hasToolUse = response.content.some((block) => block.type === "tool_use");
    if (!hasToolUse) {
      // No more tool calls, task is complete
      continueLoop = false;

      // If we added assistant content but didn't add it to history yet (pure text response)
      if (assistantContent.length > 0 && messages[messages.length - 1].role !== "assistant") {
        messages.push({
          role: "assistant",
          content: assistantContent,
        });
      }
    }

    // Safety: prevent infinite loops
    if (iterationCount >= MAX_ITERATIONS) {
      const errorChunk: MessageChunk = {
        type: "complete",
        content: `Stopped after ${MAX_ITERATIONS} iterations to prevent infinite loop`,
        isError: true,
      };
      if (onChunk) onChunk(errorChunk);
      yield errorChunk;
    }
  }

  // Signal completion
  const completeChunk: MessageChunk = {
    type: "complete",
    content: "Task execution complete",
  };
  if (onChunk) onChunk(completeChunk);
  yield completeChunk;

  // Return final conversation history
  return messages;
}
