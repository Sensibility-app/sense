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
  description: "Create a new file in the project directory (fails if file already exists). Automatically creates parent directories if needed.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to new file within project (e.g., '/server/tools/new_tool.ts')"
      },
      file_contents: {
        type: "string",
        description: "Content to write to the new file"
      },
    },
    required: ["file_path", "file_contents"],
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

  // Validate content
  if (input.file_contents === undefined || typeof input.file_contents !== "string") {
    return {
      content: "file_contents is required and must be a string",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.file_path);

    // Check if file already exists
    try {
      await Deno.stat(path);
      return {
        content: `File ${input.file_path} already exists. Use edit_file_range or edit_file to modify existing files.`,
        isError: true,
      };
    } catch {
      // File doesn't exist, we can create it
    }

    // Create parent directories if needed
    await Deno.mkdir(dirname(path), { recursive: true });

    // Write file
    await Deno.writeTextFile(path, input.file_contents);

    return { content: `Successfully created ${input.file_path}`, isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
