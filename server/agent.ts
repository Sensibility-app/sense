import { join } from "jsr:@std/path@^1.0.0";
import { getToolDefinitions, executeTool } from "./tools-loader.ts";
import { log, error } from "./logger.ts";
import { CONFIG, PATHS } from "./config.ts";
import type { Block, ContentPart } from "../shared/messages.ts";
import {
  createClient,
  type LLMClient,
  type ChatResponse,
  type StreamEvent as LLMEvent,
} from "think";

let cachedTools: Awaited<ReturnType<typeof getToolDefinitions>> | null = null;
let cachedSystemPrompt: string | null = null;
let client: LLMClient | null = null;

async function getTools() {
  if (!cachedTools) cachedTools = await getToolDefinitions();
  return cachedTools;
}

async function getSystemPrompt(): Promise<string> {
  if (!cachedSystemPrompt) {
    cachedSystemPrompt = await Deno.readTextFile(join(PATHS.BASE, "SYSTEM.md"));
  }
  // Notes are NOT cached — they change between tasks
  let notes = "";
  try {
    notes = await Deno.readTextFile(join(PATHS.BASE, "NOTES.md"));
  } catch {
    // No notes file — that's fine
  }
  return notes
    ? `${cachedSystemPrompt}\n\n<current_notes>\n${notes}\n</current_notes>`
    : cachedSystemPrompt;
}

export function invalidateAgentCache(): void {
  cachedTools = null;
  cachedSystemPrompt = null;
  log("Agent cache invalidated (tools + system prompt)");
}

function getClient(): LLMClient {
  if (!client) {
    client = createClient();
    log("LLM client initialized");
  }
  return client;
}

function truncateToolResult(content: string | ContentPart[]): string | ContentPart[] {
  if (typeof content === "string") {
    if (content.length <= CONFIG.TOOL_RESULT_MAX_LENGTH) return content;
    return content.slice(0, CONFIG.TOOL_RESULT_MAX_LENGTH) +
      "\n\n[Truncated. Use more specific queries or filters to narrow results.]";
  }
  return content.map(part => {
    if (part.type === "text" && part.text.length > CONFIG.TOOL_RESULT_MAX_LENGTH) {
      return { ...part, text: part.text.slice(0, CONFIG.TOOL_RESULT_MAX_LENGTH) + "\n\n[Truncated.]" };
    }
    return part;
  });
}

export type StreamEvent =
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_complete"; content: string; signature: string }
  | { type: "text_delta"; content: string }
  | { type: "text_complete"; content: string }
  | { type: "tool_use"; toolId: string; toolName: string; toolInput: unknown }
  | { type: "tool_result"; toolId: string; toolOutput: string | ContentPart[]; toolError: boolean }
  | { type: "server_tool_start"; toolId: string; toolName: string }
  | { type: "server_tool_result"; toolId: string; toolName: string; content: unknown }
  | { type: "turn_complete"; blocks: Block[] }
  | { type: "token_usage"; usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } }
  | { type: "complete" };

export async function handleIncomingMessage(content: string, from: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();

  const response: ChatResponse = await getClient().chat({
    max_tokens: CONFIG.MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: "user", content: `[Message from ${from}]: ${content}` }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += (text ? "\n" : "") + block.text;
  }
  return text;
}

export async function* continueConversation(
  messages: Array<{ role: "user" | "assistant"; content: string | Block[] }>,
  shouldStop?: () => boolean,
): AsyncGenerator<StreamEvent> {
  const tools = await getTools();
  const systemPrompt = await getSystemPrompt();
  const workingMessages = structuredClone(messages);

  for (let iteration = 0; iteration < CONFIG.MAX_ITERATIONS; iteration++) {
    if (shouldStop?.()) {
      yield { type: "text_delta", content: "\n\nTask stopped by user.\n" };
      yield { type: "text_complete", content: "\n\nTask stopped by user.\n" };
      break;
    }

    const assistantBlocks: Block[] = [];
    const pendingTools: Array<{ id: string; name: string; input: unknown; parseError?: string }> = [];
    let pauseTurn = false;
    let currentThinking = "";
    let currentText = "";
    let currentTool: { id: string; name: string; json: string } | null = null;
    let currentServerTool: { id: string; name: string; json: string } | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    for await (const event of getClient().stream({
      max_tokens: CONFIG.MAX_TOKENS,
      system: systemPrompt,
      messages: workingMessages,
      tools,
    })) {
      switch (event.type) {
        case "thinking":
          currentThinking += event.text;
          yield { type: "thinking_delta", content: event.text };
          break;

        case "thinking_done":
          assistantBlocks.push({ type: "thinking", thinking: currentThinking, signature: event.signature });
          yield { type: "thinking_complete", content: currentThinking, signature: event.signature };
          currentThinking = "";
          break;

        case "text":
          currentText += event.text;
          yield { type: "text_delta", content: event.text };
          break;

        case "tool_start":
          if (currentText) {
            assistantBlocks.push({ type: "text", text: currentText });
            yield { type: "text_complete", content: currentText };
            currentText = "";
          }
          currentTool = { id: event.id, name: event.name, json: "" };
          break;

        case "tool_input":
          if (currentTool) currentTool.json += event.json;
          if (currentServerTool) currentServerTool.json += event.json;
          break;

        case "tool_done": {
          if (!currentTool) break;
          let parsedInput: unknown = {};
          let parseError: string | undefined;
          const rawJson = currentTool.json.trim();
          if (rawJson === "" || rawJson === "{}") {
            parsedInput = {};
          } else {
            try {
              parsedInput = JSON.parse(rawJson);
            } catch (err) {
              error("Failed to parse tool input JSON:", currentTool.json, err);
              parseError = `Malformed JSON input: ${(err as Error).message}. Retry with shorter or simpler input.`;
            }
          }
          assistantBlocks.push({ type: "tool_use", id: currentTool.id, name: currentTool.name, input: parsedInput });
          log(`[TOOL] ${currentTool.name}(${JSON.stringify(parsedInput)})`);
          yield { type: "tool_use", toolId: currentTool.id, toolName: currentTool.name, toolInput: parsedInput };
          pendingTools.push({ id: currentTool.id, name: currentTool.name, input: parsedInput, parseError });
          currentTool = null;
          break;
        }


        case "server_tool_start":
          if (currentText) {
            assistantBlocks.push({ type: "text", text: currentText });
            yield { type: "text_complete", content: currentText };
            currentText = "";
          }
          currentServerTool = { id: event.id, name: event.name, json: "" };
          yield { type: "server_tool_start", toolId: event.id, toolName: event.name };
          break;

        case "server_tool_done": {
          if (!currentServerTool) break;
          let parsedInput: Record<string, unknown> = {};
          try {
            const raw = currentServerTool.json.trim();
            if (raw && raw !== "{}") parsedInput = JSON.parse(raw);
          } catch { /* ignore parse errors */ }
          assistantBlocks.push({
            type: "server_tool_use",
            id: currentServerTool.id,
            name: currentServerTool.name,
            input: parsedInput,
          });
          currentServerTool = null;
          break;
        }

        case "server_tool_result":
          assistantBlocks.push({
            type: event.name,
            tool_use_id: event.id,
            content: event.content,
          });
          yield { type: "server_tool_result", toolId: event.id, toolName: event.name, content: event.content };
          break;

        case "citation":
          // Citations are attached to text blocks — not yielded separately to the UI for now
          break;

        case "compaction":
          assistantBlocks.push({ type: "compaction", content: event.content });
          log(`[COMPACTION] Context compacted (${event.content.length} chars summary)`);
          break;

        case "usage":
          if (currentText) {
            assistantBlocks.push({ type: "text", text: currentText });
            yield { type: "text_complete", content: currentText };
            currentText = "";
          }
          inputTokens = event.usage.input;
          outputTokens = event.usage.output;
          cacheCreationInputTokens = event.usage.cache_create;
          cacheReadInputTokens = event.usage.cache_read;
          break;

        case "error":
          throw new Error(event.message);

        case "done":
          if (currentText) {
            assistantBlocks.push({ type: "text", text: currentText });
            yield { type: "text_complete", content: currentText };
            currentText = "";
          }
          break;

        case "pause_turn":
          pauseTurn = true;
          break;
      }
    }

    workingMessages.push({ role: "assistant", content: assistantBlocks });
    yield { type: "turn_complete", blocks: assistantBlocks };

    if (pendingTools.length > 0) {
      const toolResultBlocks: Block[] = [];
      const results = await Promise.allSettled(
        pendingTools.map(t =>
          t.parseError
            ? Promise.reject(new Error(t.parseError))
            : executeTool(t.name, t.input as Record<string, unknown>)
        )
      );

      for (let i = 0; i < pendingTools.length; i++) {
        const tool = pendingTools[i];
        const settled = results[i];
        const result = settled.status === "fulfilled"
          ? settled.value
          : { content: (settled.reason as Error)?.message || "Tool execution failed", isError: true };
        const content = truncateToolResult(result.content);
        toolResultBlocks.push({ type: "tool_result", tool_use_id: tool.id, content, is_error: result.isError });
        yield { type: "tool_result", toolId: tool.id, toolOutput: content, toolError: result.isError };
      }

      workingMessages.push({ role: "user", content: toolResultBlocks });
      yield { type: "turn_complete", blocks: toolResultBlocks };
    }

    yield {
      type: "token_usage",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      },
    };

    if (pauseTurn) continue;

    if (pendingTools.length === 0) break;
  }

  yield { type: "complete" };
}
