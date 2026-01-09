/**
 * read_file tool - Read file contents
 *
 * Reads text files from the filesystem with size limits to prevent
 * context explosion.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";
import { MAX_FILE_SIZE_CHARS } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "read_file",
  description: "Read file contents",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
    },
    required: ["path"],
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate input
  if (!input.path || typeof input.path !== "string") {
    return {
      content: "Path is required and must be a string",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.path);

    // Read file content
    let content = await Deno.readTextFile(path);

    // Limit file size to prevent context explosion
    if (content.length > MAX_FILE_SIZE_CHARS) {
      content = content.slice(0, MAX_FILE_SIZE_CHARS) +
        `\n\n... [file truncated at ${MAX_FILE_SIZE_CHARS} characters, total size: ${content.length} chars]`;
    }

    return { content, isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
