/**
 * read_file tool - Read file contents
 *
 * Reads text files from the filesystem with size limits to prevent
 * context explosion.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath, sanitizeErrorMessage } from "../tools/_shared/sanitize.ts";
import { MAX_FILE_SIZE_CHARS } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "read_file",
  description: "Read file contents from the project directory",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to file within project (e.g., '/server/main.ts', '/client/index.html')"
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
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate input
  if (!input.file_path || typeof input.file_path !== "string") {
    return {
      content: "file_path is required and must be a string",
      isError: true,
    };
  }

  // Validate optional offset
  if (input.offset !== undefined && typeof input.offset !== "number") {
    return {
      content: "offset must be a number if provided",
      isError: true,
    };
  }

  // Validate optional limit
  if (input.limit !== undefined && typeof input.limit !== "number") {
    return {
      content: "limit must be a number if provided",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.file_path);

    // Read file content
    let content = await Deno.readTextFile(path);

    // Handle offset/limit if provided
    if (input.offset !== undefined || input.limit !== undefined) {
      const lines = content.split("\n");
      const startLine = Math.max(0, (input.offset || 1) - 1);
      const endLine = input.limit !== undefined
        ? startLine + input.limit
        : lines.length;

      const selectedLines = lines.slice(startLine, endLine);
      content = selectedLines.map((line, idx) =>
        `${startLine + idx + 1}: ${line}`
      ).join("\n");

      return { content, isError: false };
    }

    // Limit file size to prevent context explosion
    if (content.length > MAX_FILE_SIZE_CHARS) {
      content = content.slice(0, MAX_FILE_SIZE_CHARS) +
        `\n\n... [file truncated at ${MAX_FILE_SIZE_CHARS} characters, total size: ${content.length} chars]`;
    }

    return { content, isError: false };
  } catch (error) {
    return {
      content: sanitizeErrorMessage(error),
      isError: true,
    };
  }
};
