/**
 * read_file_range tool - Read specific line range from file
 *
 * Reads a specific range of lines from a file (1-indexed).
 * Use -1 for end_line to read until end of file.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "read_file_range",
  description: "Read specific line range (1-indexed)",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      start_line: { type: "number", description: "Start line (1-indexed)" },
      end_line: { type: "number", description: "End line (-1 for EOF)" },
    },
    required: ["path", "start_line", "end_line"],
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate path
  if (!input.path || typeof input.path !== "string") {
    return {
      content: "Path is required and must be a string",
      isError: true,
    };
  }

  // Validate line numbers
  if (typeof input.start_line !== "number" || typeof input.end_line !== "number") {
    return {
      content: "start_line and end_line are required and must be numbers",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.path);

    // Read file and split into lines
    const content = await Deno.readTextFile(path);
    const lines = content.split("\n");

    // Calculate indices
    const startIdx = Math.max(0, input.start_line - 1);
    const endIdx = input.end_line === -1 ? lines.length : input.end_line;

    // Validate start line
    if (startIdx >= lines.length) {
      return {
        content: `start_line ${input.start_line} exceeds file length (${lines.length} lines)`,
        isError: true,
      };
    }

    // Extract and format lines with line numbers
    const selectedLines = lines.slice(startIdx, endIdx);
    const result = selectedLines.map((line, idx) =>
      `${startIdx + idx + 1}: ${line}`
    ).join("\n");

    return { content: result, isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
