/**
 * edit_file tool - Edit file by string replacement
 *
 * Edits a file by replacing an exact string match. For multi-line edits,
 * use edit_file_range instead for more reliable editing.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read", "write"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "edit_file",
  description: "Edit a file by replacing an exact string match. For multi-line edits, use edit_file_range instead.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to file within project (e.g., '/server/main.ts')"
      },
      old_str: {
        type: "string",
        description: "The exact string to find and replace (must match exactly including whitespace)"
      },
      new_str: {
        type: "string",
        description: "The replacement text"
      },
    },
    required: ["file_path", "old_str", "new_str"],
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

  // Validate old_str
  if (!input.old_str || typeof input.old_str !== "string") {
    return {
      content: "old_str is required and must be a string",
      isError: true,
    };
  }

  // Validate new_str
  if (input.new_str === undefined || typeof input.new_str !== "string") {
    return {
      content: "new_str is required and must be a string",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.file_path);

    // Read current file content
    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch {
      return {
        content: `File ${input.file_path} not found. Use create_file to create new files.`,
        isError: true,
      };
    }

    // Find and replace
    if (!content.includes(input.old_str)) {
      return {
        content: `String not found in ${input.file_path}. Make sure old_str matches exactly (including whitespace). Consider using edit_file_range for more reliable editing.`,
        isError: true,
      };
    }

    const newContent = content.replace(input.old_str, input.new_str);
    await Deno.writeTextFile(path, newContent);

    return {
      content: `Successfully edited ${input.file_path}`,
      isError: false
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
