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


function evictOldThinkingBlocks(
  messages: Array<{ role: string; content: string | Block[] }>,
): void {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") { lastAssistantIdx = i; break; }
  }
  for (let i = 0; i < lastAssistantIdx; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    msg.content = msg.content.filter(block => block.type !== "thinking");
  }
}

function truncateToolResult(content: string): string {
  if (content.length <= CONFIG.TOOL_RESULT_MAX_LENGTH) return content;
  return content.slice(0, CONFIG.TOOL_RESULT_MAX_LENGTH) +
    "\n\n[Truncated. Use more specific queries or filters to narrow results.]";
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
  let workingMessages = structuredClone(messages);

  let cumulativeInputTokens = 0;
  let lastIterationInputTokens = 0;

  for (let iteration = 0; iteration < CONFIG.MAX_ITERATIONS; iteration++) {
    if (shouldStop?.()) {
      yield { type: "text_delta", content: "\n\nTask stopped by user.\n" };
      yield { type: "text_complete", content: "\n\nTask stopped by user.\n" };
      break;
    }

    clearOldToolResults(workingMessages);
    evictOldThinkingBlocks(workingMessages);

    // Hard fail-safe: mechanical truncation at hard limit (no LLM call, can't fail)
    const currentTokens = lastIterationInputTokens > 0
      ? lastIterationInputTokens
      : estimateTokens(workingMessages);
    if (currentTokens > CONFIG.CONTEXT_HARD_LIMIT) {
      const keepCount = CONFIG.FAILSAFE_KEEP_RECENT;
      const dropped = workingMessages.length - keepCount;
      if (dropped > 0) {
        log(`Hard limit exceeded (${currentTokens} tokens), truncating ${dropped} messages`);
        const kept = workingMessages.slice(-keepCount);
        // Drop orphaned tool_result messages whose tool_use was truncated away
        while (
          kept.length > 0 &&
          kept[0].role === "user" &&
          Array.isArray(kept[0].content) &&
          (kept[0].content as Block[]).every(b => b.type === "tool_result")
        ) {
          kept.shift();
        }
        workingMessages = [
          { role: "user" as const, content: `[EMERGENCY: Context auto-truncated \u2014 ${dropped} messages dropped to prevent failure. Read NOTES.md for earlier context.]` },
        ];
        if (kept[0]?.role !== "assistant") {
          workingMessages.push({ role: "assistant" as const, content: "Understood. Reading NOTES.md to restore context." });
        }
        workingMessages.push(...kept);
      }
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
          cumulativeInputTokens += inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
          lastIterationInputTokens = inputTokens;
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

      if (iteration >= 1 && toolResultBlocks.length > 0) {
        const lastResult = toolResultBlocks[toolResultBlocks.length - 1];
        if (lastResult.type === "tool_result") {
          const tokensK = Math.round(cumulativeInputTokens / 1000);
          let nudge: string;
          if (cumulativeInputTokens > CONFIG.CONTEXT_CRITICAL_THRESHOLD) {
            nudge = `\ud83d\udea8 CRITICAL: Auto-truncation at ${Math.round(CONFIG.CONTEXT_HARD_LIMIT / 1000)}k! Save context to NOTES.md and call /compact NOW`;
          } else if (cumulativeInputTokens > CONFIG.CONTEXT_WARNING_THRESHOLD) {
            nudge = `\u26a0\ufe0f Context large \u2014 use /compact with /notes to preserve context`;
          } else if (cumulativeInputTokens > CONFIG.CONTEXT_SUGGEST_THRESHOLD) {
            nudge = `Consider using /compact soon`;
          } else {
            nudge = `Batch remaining tool calls to minimize iterations`;
          }
          lastResult.content += `\n\n[Iter ${iteration + 1}/${CONFIG.MAX_ITERATIONS} | ${tokensK}k tokens | ${nudge}]`;
        }
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
