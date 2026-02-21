import { join } from "jsr:@std/path@^1.0.0";
import { getToolDefinitions, executeTool } from "./tools-loader.ts";
import { log, error } from "./logger.ts";
import { CONFIG, PATHS } from "./config.ts";
import type { Block } from "../shared/messages.ts";
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
  return cachedSystemPrompt;
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

// --- Context Management Helpers ---

function estimateTokens(messages: Array<{ role: string; content: string | Block[] }>): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else {
      for (const block of msg.content) {
        switch (block.type) {
          case "thinking": chars += block.thinking.length; break;
          case "text": chars += block.text.length; break;
          case "tool_use": chars += JSON.stringify(block.input).length + block.name.length; break;
          case "tool_result": chars += block.content.length; break;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

function clearOldToolResults(
  messages: Array<{ role: string; content: string | Block[] }>,
): void {
  const clearBefore = messages.length - CONFIG.TOOL_RESULT_CLEAR_AFTER;
  if (clearBefore <= 0) return;
  for (let i = 0; i < clearBefore; i++) {
    const msg = messages[i];
    if (typeof msg.content === "string" || msg.role !== "user") continue;
    for (const block of msg.content) {
      if (block.type === "tool_result" && block.content.length > 200) {
        block.content = "[Previous tool result cleared to save context]";
      }
    }
  }
}

function truncateToolResult(content: string): string {
  if (content.length <= CONFIG.TOOL_RESULT_MAX_LENGTH) return content;
  return content.slice(0, CONFIG.TOOL_RESULT_MAX_LENGTH) +
    "\n\n[Truncated. Use more specific queries or filters to narrow results.]";
}

async function compactMessages(
  messages: Array<{ role: "user" | "assistant"; content: string | Block[] }>,
): Promise<Array<{ role: "user" | "assistant"; content: string | Block[] }>> {
  let cutIndex = messages.length - CONFIG.COMPACT_KEEP_RECENT;
  if (cutIndex <= 1) return messages;

  // Don't orphan tool_result blocks from their matching tool_use
  const cutMsg = messages[cutIndex];
  if (cutMsg.role === "user" && Array.isArray(cutMsg.content) &&
      cutMsg.content.some((b: Block) => b.type === "tool_result")) {
    cutIndex--;
  }
  if (cutIndex <= 0) return messages;

  const toCompact = messages.slice(0, cutIndex);
  const toKeep = messages.slice(cutIndex);

  const formatted = toCompact.map(m => {
    if (typeof m.content === "string") return `[${m.role}]: ${m.content}`;
    return m.content.map((b: Block) => {
      switch (b.type) {
        case "thinking": return `[thinking]: ${b.thinking.slice(0, 500)}...`;
        case "text": return `[${m.role}]: ${b.text}`;
        case "tool_use": return `[tool]: ${b.name}(${JSON.stringify(b.input).slice(0, 300)})`;
        case "tool_result": return `[result]: ${b.content.slice(0, 300)}`;
        default: return "";
      }
    }).join("\n");
  }).join("\n\n");

  const response = await getClient().chat({
    model: CONFIG.CLAUDE_MODEL,
    max_tokens: 2048,
    system: "Summarize this conversation for an AI agent to continue working. Preserve: file paths modified, key decisions, current task state, unresolved issues, and the user's original request. Be concise but miss nothing critical.",
    messages: [{ role: "user", content: formatted }],
  });

  let summary = "";
  for (const block of response.content) {
    if (block.type === "text") summary += block.text;
  }

  log(`Auto-compacted: ${toCompact.length} messages -> summary, kept ${toKeep.length} recent`);

  const compacted: Array<{ role: "user" | "assistant"; content: string | Block[] }> = [
    { role: "user", content: `[Context auto-compacted: ${toCompact.length} messages summarized]\n\n${summary}` },
  ];

  if (toKeep[0]?.role !== "assistant") {
    compacted.push({ role: "assistant", content: "Understood. Continuing with the compacted context." });
  }

  return [...compacted, ...toKeep];
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

export async function handleIncomingMessage(content: string, from: string): Promise<string> {
  const systemPrompt = await getSystemPrompt();

  const response: ChatResponse = await getClient().chat({
    model: CONFIG.CLAUDE_MODEL,
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
  let workingMessages = [...messages];

  for (let iteration = 0; iteration < CONFIG.MAX_ITERATIONS; iteration++) {
    if (shouldStop?.()) {
      yield { type: "text_delta", content: "\n\nTask stopped by user.\n" };
      yield { type: "text_complete", content: "\n\nTask stopped by user.\n" };
      break;
    }

    clearOldToolResults(workingMessages);
    if (estimateTokens(workingMessages) > CONFIG.CONTEXT_TOKEN_THRESHOLD) {
      log("Context threshold exceeded, auto-compacting...");
      workingMessages = await compactMessages(workingMessages);
    }

    const assistantBlocks: Block[] = [];
    const pendingTools: Array<{ id: string; name: string; input: unknown }> = [];
    let currentThinking = "";
    let currentText = "";
    let currentTool: { id: string; name: string; json: string } | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;

    for await (const event of getClient().stream({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      system: systemPrompt,
      messages: workingMessages,
      tools,
      thinking: { budget: 10000 },
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
          break;

        case "tool_done": {
          if (!currentTool) break;
          let parsedInput: unknown = {};
          try {
            parsedInput = JSON.parse(currentTool.json);
          } catch (err) {
            error("Failed to parse tool input JSON:", currentTool.json, err);
          }

          assistantBlocks.push({ type: "tool_use", id: currentTool.id, name: currentTool.name, input: parsedInput });
          log(`[TOOL] ${currentTool.name}(${JSON.stringify(parsedInput)})`);
          yield { type: "tool_use", toolId: currentTool.id, toolName: currentTool.name, toolInput: parsedInput };

          pendingTools.push({ id: currentTool.id, name: currentTool.name, input: parsedInput });
          currentTool = null;
          break;
        }

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
      }
    }

    workingMessages.push({ role: "assistant", content: assistantBlocks });
    yield { type: "turn_complete", blocks: assistantBlocks };

    if (pendingTools.length > 0) {
      const toolResultBlocks: Block[] = [];
      const results = await Promise.allSettled(
        pendingTools.map(t => executeTool(t.name, t.input as Record<string, unknown>))
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

    if (pendingTools.length === 0) break;
  }

  yield { type: "complete" };
}
