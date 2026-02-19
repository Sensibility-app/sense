import { join } from "jsr:@std/path@^1.0.0";
import { getToolDefinitions, executeTool } from "./tools-loader.ts";
import { log, error } from "./logger.ts";
import { CONFIG, PATHS } from "./config.ts";
import type { ToolDefinition } from "./tools/_shared/tool-utils.ts";
import type { Block } from "../shared/messages.ts";
import {
  createClient,
  type LLMClient,
  type StreamEvent as LLMStreamEvent,
  type MessageCreateParams,
} from "llm";

let cachedTools: ToolDefinition[] | null = null;
let cachedSystemPrompt: string | null = null;
let client: LLMClient | null = null;

async function getTools(): Promise<ToolDefinition[]> {
  if (!cachedTools) {
    cachedTools = await getToolDefinitions();
  }
  return cachedTools;
}

async function getSystemPrompt(): Promise<string> {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = await Deno.readTextFile(join(PATHS.BASE, "SYSTEM.md"));
  }
  return cachedSystemPrompt;
}

export function invalidateClaudeCache(): void {
  cachedTools = null;
  cachedSystemPrompt = null;
  log("Claude cache invalidated (tools + system prompt)");
}

function getClient(): LLMClient {
  if (!client) {
    client = createClient();
    log("LLM client initialized");
  }
  return client;
}

export type StreamEvent =
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_complete"; content: string; signature: string }
  | { type: "text_delta"; content: string }
  | { type: "text_complete"; content: string }
  | { type: "tool_use"; toolId: string; toolName: string; toolInput: unknown }
  | { type: "tool_result"; toolId: string; toolOutput: string; toolError: boolean }
  | { type: "turn_complete"; blocks: Block[] }
  | { type: "token_usage"; usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } }
  | { type: "complete" };

export async function* continueConversation(
  messages: Array<{ role: "user" | "assistant"; content: string | Block[] }>,
  shouldStop?: () => boolean,
): AsyncGenerator<StreamEvent> {
  const TOOLS = await getTools();
  const SYSTEM_PROMPT = await getSystemPrompt();

  const workingMessages = [...messages];
  
  for (let iteration = 0; iteration < CONFIG.MAX_ITERATIONS; iteration++) {
    if (shouldStop?.()) {
      yield { type: "text_delta", content: "\n\nTask stopped by user.\n" };
      yield { type: "text_complete", content: "\n\nTask stopped by user.\n" };
      break;
    }

    const toolsWithCache = TOOLS.map((tool, idx) =>
      idx === TOOLS.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool
    );

    const stream = await getClient().messages.create({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: workingMessages as MessageCreateParams["messages"],
      tools: toolsWithCache,
      stream: true,
      thinking: { type: "enabled", budget_tokens: 10000 },
    });

    const assistantBlocks: Block[] = [];
    const toolResultBlocks: Block[] = [];
    let currentThinking = "";
    let currentThinkingSignature = "";
    let currentText = "";
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let thinkingBlockIndex = -1;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    for await (const chunk of stream) {
      if (chunk.type === "message_start") {
        const usage = chunk.message.usage;
        inputTokens = usage.input_tokens;
        cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
        cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
      } else if (chunk.type === "content_block_start") {
        const block = chunk.content_block;
        if (block.type === "thinking") {
          currentThinking = "";
          currentThinkingSignature = "";
          thinkingBlockIndex = chunk.index;
        } else if (block.type === "text") {
          currentText = "";
        } else if (block.type === "tool_use") {
          currentToolUse = { id: block.id, name: block.name, input: "" };
        }
      } else if (chunk.type === "content_block_delta") {
        if (chunk.delta.type === "thinking_delta") {
          currentThinking += chunk.delta.thinking;
          yield { type: "thinking_delta", content: chunk.delta.thinking };
        } else if (chunk.delta.type === "signature_delta") {
          currentThinkingSignature += chunk.delta.signature;
        } else if (chunk.delta.type === "text_delta") {
          currentText += chunk.delta.text;
          yield { type: "text_delta", content: chunk.delta.text };
        } else if (chunk.delta.type === "input_json_delta" && currentToolUse) {
          currentToolUse.input += chunk.delta.partial_json;
        }
      } else if (chunk.type === "content_block_stop") {
        if (currentThinking && chunk.index === thinkingBlockIndex) {
          assistantBlocks.push({ type: "thinking", thinking: currentThinking, signature: currentThinkingSignature });
          yield { type: "thinking_complete", content: currentThinking, signature: currentThinkingSignature };
          currentThinking = "";
          currentThinkingSignature = "";
          thinkingBlockIndex = -1;
        } else if (currentText) {
          assistantBlocks.push({ type: "text", text: currentText });
          yield { type: "text_complete", content: currentText };
          currentText = "";
        } else if (currentToolUse) {
          let parsedInput: unknown = {};
          try {
            parsedInput = JSON.parse(currentToolUse.input);
          } catch (err) {
            error("Failed to parse tool input JSON:", currentToolUse.input, err);
          }
          
          assistantBlocks.push({ type: "tool_use", id: currentToolUse.id, name: currentToolUse.name, input: parsedInput });
          
          log(`[TOOL] ${currentToolUse.name}(${JSON.stringify(parsedInput)})`);
          yield { type: "tool_use", toolId: currentToolUse.id, toolName: currentToolUse.name, toolInput: parsedInput };
          
          const result = await executeTool(currentToolUse.name, parsedInput as Record<string, unknown>);
          
          toolResultBlocks.push({ type: "tool_result", tool_use_id: currentToolUse.id, content: result.content, is_error: result.isError });
          yield { type: "tool_result", toolId: currentToolUse.id, toolOutput: result.content, toolError: result.isError };
          
          currentToolUse = null;
        }
      } else if (chunk.type === "message_delta" && chunk.usage) {
        outputTokens = chunk.usage.output_tokens;
      }
    }

    workingMessages.push({ role: "assistant", content: assistantBlocks });
    yield { type: "turn_complete", blocks: assistantBlocks };

    if (toolResultBlocks.length > 0) {
      workingMessages.push({ role: "user", content: toolResultBlocks });
      yield { type: "turn_complete", blocks: toolResultBlocks };
    }

    yield {
      type: "token_usage",
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cacheCreationInputTokens, cacheReadInputTokens },
    };

    if (toolResultBlocks.length === 0) break;
  }

  yield { type: "complete" };
}
