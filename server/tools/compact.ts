import { createClient, type TextBlock } from "../llm.ts";
import { createTool, PERMISSIONS, ToolResult } from "./_shared/tool-utils.ts";
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

Conversation to summarize:
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
    }
  }).join("\n");
}

export const { definition, permissions, executor } = createTool(
  {
    name: "compact",
    description: "Compact session history by summarizing old turns. Keeps recent turns intact while compressing older context into a summary. Use when session is getting too large.",
    input_schema: {
      type: "object",
      properties: {
        keep_recent: {
          type: "number",
          description: "Number of recent turns to keep in full (default: 10)"
        },
      },
      required: [],
    },
  },
  PERMISSIONS.READ_WRITE,
  async (input): Promise<ToolResult> => {
    const keepRecent = (input.keep_recent as number) || 10;
    const ctx = getToolContext();
    const session = ctx.session;

    const sizeInfo = session.getSessionSizeInfo();
    
    if (sizeInfo.turnCount <= keepRecent) {
      return {
        content: `Session has only ${sizeInfo.turnCount} turns. Nothing to compact (threshold: ${keepRecent}).`,
        isError: false,
      };
    }

    const { toCompact, toKeep } = session.getTurnsForCompaction(keepRecent);

    if (toCompact.length === 0) {
      return {
        content: `No turns to compact. Session has ${sizeInfo.turnCount} turns, keeping ${keepRecent}.`,
        isError: false,
      };
    }

    log(`Compacting ${toCompact.length} turns, keeping ${toKeep.length} recent`);

    const formattedHistory = toCompact.map(formatTurn).join("\n\n");

    const client = createClient();

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: COMPACT_PROMPT + formattedHistory
      }]
    });

    const summary = response.content
      .filter((block): block is TextBlock => block.type === "text")
      .map(block => block.text)
      .join("\n");

    if (!summary) {
      return {
        content: "Failed to generate summary",
        isError: true,
      };
    }

    const result = await session.compact(summary, keepRecent);

    const newSizeInfo = session.getSessionSizeInfo();

    return {
      content: `Session compacted successfully.

Before: ${sizeInfo.turnCount} turns (~${sizeInfo.estimatedTokens} tokens)
After: ${newSizeInfo.turnCount} turns (~${newSizeInfo.estimatedTokens} tokens)

Compacted ${result.compactedCount} turns into summary, kept ${result.keptCount} recent turns.`,
      isError: false,
    };
  }
);
