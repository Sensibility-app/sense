/**
 * create_file tool - Create new file
 *
 * Creates a new file with the specified content. Fails if file already exists.
 * Automatically creates parent directories if needed.
 */

import { dirname } from "jsr:@std/path@^1.0.0";
import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["write"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "create_file",
  description: "Create new file (fails if exists). Auto-creates parent dirs.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "File content" },
    },
    required: ["path", "content"],
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

  // Validate content
  if (input.content === undefined || typeof input.content !== "string") {
    return {
      content: "Content is required and must be a string",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.path);

    // Check if file already exists
    try {
      await Deno.stat(path);
      return {
        content: `File ${input.path} already exists. Use edit_file_range or edit_file to modify existing files.`,
        isError: true,
      };
    } catch {
      // File doesn't exist, we can create it
    }

    // Create parent directories if needed
    await Deno.mkdir(dirname(path), { recursive: true });

    // Write file
    await Deno.writeTextFile(path, input.content);

    return { content: `Successfully created ${input.path}`, isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
