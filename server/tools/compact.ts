import { createClient } from "think";
import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { getToolContext } from "../tools-loader.ts";
import { log } from "../logger.ts";
import type { Turn, Block } from "../../shared/messages.ts";

const COMPACT_PROMPT = `Summarize this conversation history for continuing a coding session. 

Your summary MUST preserve:
1. Files that were modified (with paths)
2. Key architectural decisions made
3. Current task state (what we're working on)
4. Any unresolved issues or next steps
5. Important context the assistant would need to continue work

Be concise but comprehensive. Format as structured text.
`;

function formatTurn(turn: Turn): string {
  if (typeof turn.content === "string") {
    return `[${turn.role}]: ${turn.content}`;
  }
  
  return turn.content.map((block: Block) => {
    switch (block.type) {
      case "thinking":
        return `[thinking]: ${block.thinking}`;
      case "text":
        return `[${turn.role}]: ${block.text}`;
      case "tool_use":
        return `[tool_use]: ${block.name}\nInput: ${JSON.stringify(block.input)}`;
      case "tool_result":
        return `[tool_result]: ${block.content}`;
      default: return "";
    }
  }).join("\n");
}

export const { definition, executor } = createTool(
  {
    name: "compact",
    description: "Summarize conversation history to free up context window. Preserves key decisions, file changes, and current task state. Full chat history is kept for the UI — only the LLM view is compacted.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async (): Promise<ToolResult> => {
    const ctx = getToolContext();
    const { toCompact, toKeep, previousSummary } = ctx.session.getTurnsForCompaction();

    if (toCompact.length === 0) {
      return { content: "Not enough conversation to compact.", isError: false };
    }

    const formatted = toCompact.map(formatTurn).join("\n\n");

    let prompt = COMPACT_PROMPT;
    if (previousSummary) {
      prompt += `\nPrevious session summary (incorporate and extend this):\n${previousSummary}\n\n`;
    }
    prompt += `New conversation to summarize:\n${formatted}`;

    const client = createClient();
    const response = await client.chat({
      model: "fast",
      max_tokens: 4096,
      system: "You are a precise summarizer. Output structured text only.",
      messages: [{ role: "user", content: prompt }],
    });

    let summary = "";
    for (const block of response.content) {
      if (block.type === "text") summary += block.text;
    }

    if (!summary.trim()) {
      return { content: "Failed to generate summary.", isError: true };
    }

    const { compactedCount, keptCount } = await ctx.session.compact(summary);
    ctx.invalidateAgent();
    log(`Compacted ${compactedCount} turns into summary (${keptCount} kept, ${previousSummary ? "cumulative" : "first"} compaction)`);

    return {
      content: `Compacted ${compactedCount} turns. ${keptCount} recent turns kept for LLM context. Full history preserved for UI.`,
      isError: false,
    };
  },
);
