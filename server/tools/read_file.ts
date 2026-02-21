/**
 * read_file tool - Read file contents
 *
 * Reads text files from the filesystem with size limits to prevent
 * context explosion.
 */

import { createTool, type ToolResult } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";
import { CONFIG } from "../config.ts";

export const { definition, executor } = createTool(
  {
    name: "read_file",
    description: "Read file contents from the project directory",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to file relative to project root (e.g., 'server/main.ts', 'client/index.html')"
        },
        offset: {
          type: "number",
          description: "Optional: Line number to start reading from (1-indexed)"
        },
        limit: {
          type: "number",
          description: "Optional: Number of lines to read (omit to read entire file)"
        },
      },
      required: ["file_path"],
    },
  },
  async (input): Promise<ToolResult> => {
    const path = sanitizePath(input.file_path as string);

    // Read file content
    let content = await Deno.readTextFile(path);

    // Handle offset/limit if provided
    if (input.offset !== undefined || input.limit !== undefined) {
      const lines = content.split("\n");
      const startLine = Math.max(0, ((input.offset as number) || 1) - 1);
      const endLine = input.limit !== undefined
        ? startLine + (input.limit as number)
        : lines.length;

      const selectedLines = lines.slice(startLine, endLine);
      content = selectedLines.map((line, idx) =>
        `${startLine + idx + 1}: ${line}`
      ).join("\n");

      return { content, isError: false };
    }

    // Limit file size to prevent context explosion
    if (content.length > CONFIG.MAX_FILE_SIZE) {
      content = content.slice(0, CONFIG.MAX_FILE_SIZE) +
        `\n\n... [file truncated at ${CONFIG.MAX_FILE_SIZE} characters, total size: ${content.length} chars]`;
    }

    return { content, isError: false };
  }
);
