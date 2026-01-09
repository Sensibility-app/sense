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
  description: "Replace exact string match. Use edit_file_range for multi-line.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path" },
      old_string: { type: "string", description: "Text to replace (exact match)" },
      new_string: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_string", "new_string"],
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

  // Validate old_string
  if (!input.old_string || typeof input.old_string !== "string") {
    return {
      content: "old_string is required and must be a string",
      isError: true,
    };
  }

  // Validate new_string
  if (input.new_string === undefined || typeof input.new_string !== "string") {
    return {
      content: "new_string is required and must be a string",
      isError: true,
    };
  }

  try {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.path);

    // Read current file content
    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch {
      return {
        content: `File ${input.path} not found. Use create_file to create new files.`,
        isError: true,
      };
    }

    // Find and replace
    if (!content.includes(input.old_string)) {
      return {
        content: `String not found in ${input.path}. Make sure old_string matches exactly (including whitespace). Consider using edit_file_range for more reliable editing.`,
        isError: true,
      };
    }

    const newContent = content.replace(input.old_string, input.new_string);
    await Deno.writeTextFile(path, newContent);

    return {
      content: `Successfully edited ${input.path}`,
      isError: false
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
