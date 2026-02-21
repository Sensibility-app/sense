import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { PATHS } from "../config.ts";
import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";

const NOTES_PATH = join(PATHS.BASE, "NOTES.md");

export const { definition, executor } = createTool(
  {
    name: "notes",
    description:
      "Read or update your persistent notes (NOTES.md) — your long-term memory. " +
      "Survives conversation resets, compactions, and server restarts. " +
      "Store: key decisions, files modified, current task state, learnings, unresolved issues.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action: 'read' to view notes, 'write' to replace all, 'append' to add to existing",
          enum: ["read", "write", "append"],
        },
        content: {
          type: "string",
          description: "Content to write or append (required for write/append)",
        },
      },
      required: ["action"],
    },
  },
  async (input): Promise<ToolResult> => {
    const action = input.action as string;
    const content = input.content as string | undefined;

    switch (action) {
      case "read": {
        if (await exists(NOTES_PATH)) {
          const notes = await Deno.readTextFile(NOTES_PATH);
          return { content: notes || "(Notes file is empty)", isError: false };
        }
        return { content: "(No notes yet. Use write or append to start.)", isError: false };
      }
      case "write": {
        if (!content) return { content: "content is required for write action", isError: true };
        await Deno.writeTextFile(NOTES_PATH, content);
        return { content: `Notes updated (${content.length} chars)`, isError: false };
      }
      case "append": {
        if (!content) return { content: "content is required for append action", isError: true };
        const existing = await exists(NOTES_PATH) ? await Deno.readTextFile(NOTES_PATH) : "";
        const newContent = existing ? `${existing}\n\n${content}` : content;
        await Deno.writeTextFile(NOTES_PATH, newContent);
        return { content: `Appended to notes (now ${newContent.length} chars total)`, isError: false };
      }
      default:
        return { content: `Unknown action: ${action}. Use read, write, or append.`, isError: true };
    }
  },
);
