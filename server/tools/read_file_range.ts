/**
 * read_file_range tool - Read specific line range from file
 *
 * Reads a specific range of lines from a file (1-indexed).
 * Use -1 for end_line to read until end of file.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath, sanitizeErrorMessage } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "read_file_range",
  description: "Read a specific range of lines from a file (1-indexed). Use -1 for end_line to read until end of file.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to file within project (e.g., '/server/main.ts')"
      },
      start_line: {
        type: "number",
        description: "First line number to read (1-indexed)"
      },
      end_line: {
        type: "number",
        description: "Last line number to read (1-indexed, or -1 to read until end of file)"
      },
    },
    required: ["file_path", "start_line", "end_line"],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate path
  if (!input.file_path || typeof input.file_path !== "string") {
    return {
      content: "file_path is required and must be a string",
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
    const path = sanitizePath(input.file_path);

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
      content: sanitizeErrorMessage(error),
      isError: true,
    };
  }
};
