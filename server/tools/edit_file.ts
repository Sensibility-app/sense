/**
 * edit_file tool - Edit file by string replacement
 *
 * Edits a file by replacing an exact string match. For multi-line edits,
 * use edit_file_range instead for more reliable editing.
 */

import { createTool, PERMISSIONS, ToolResult } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const { definition, permissions, executor } = createTool(
  {
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
  },
  PERMISSIONS.READ_WRITE,
  async (input): Promise<ToolResult> => {
    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(input.file_path as string);

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
    const oldStr = input.old_str as string;
    const newStr = input.new_str as string;

    if (!content.includes(oldStr)) {
      return {
        content: `String not found in ${input.file_path}. Make sure old_str matches exactly (including whitespace). Consider using edit_file_range for more reliable editing.`,
        isError: true,
      };
    }

    const newContent = content.replace(oldStr, newStr);
    await Deno.writeTextFile(path, newContent);

    return {
      content: `Successfully edited ${input.file_path}`,
      isError: false
    };
  }
);
