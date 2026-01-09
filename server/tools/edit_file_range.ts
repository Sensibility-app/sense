/**
 * edit_file_range tool - Replace line range in file
 *
 * Replaces a specific range of lines in a file (1-indexed).
 * Preferred for multi-line edits for reliability.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read", "write"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "edit_file_range",
  description: "Replace a range of lines in a file (1-indexed). Preferred method for multi-line edits as it is more reliable than string matching.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file relative to project root"
      },
      start_line: {
        type: "number",
        description: "First line number to replace (1-indexed, inclusive)"
      },
      end_line: {
        type: "number",
        description: "Last line number to replace (1-indexed, inclusive)"
      },
      new_content: {
        type: "string",
        description: "The new content to insert (replaces lines start_line through end_line)"
      },
    },
    required: ["file_path", "start_line", "end_line", "new_content"],
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

  // Validate new_content
  if (input.new_content === undefined || typeof input.new_content !== "string") {
    return {
      content: "new_content is required and must be a string",
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

    // Split into lines
    const lines = content.split("\n");
    const startIdx = input.start_line - 1; // Convert to 0-indexed
    const endIdx = input.end_line; // End is exclusive in slice

    // Validate line numbers
    if (startIdx < 0 || startIdx >= lines.length) {
      return {
        content: `start_line ${input.start_line} is out of range (file has ${lines.length} lines)`,
        isError: true,
      };
    }
    if (endIdx < startIdx || endIdx > lines.length) {
      return {
        content: `end_line ${input.end_line} is out of range (must be >= start_line and <= ${lines.length})`,
        isError: true,
      };
    }

    // Replace the line range
    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx);
    const newLines = [...before, input.new_content, ...after];
    const newContent = newLines.join("\n");

    // Write new content
    await Deno.writeTextFile(path, newContent);

    const replacedCount = endIdx - startIdx;
    return {
      content: `Successfully edited ${input.file_path} (replaced lines ${input.start_line}-${input.end_line}, ${replacedCount} lines replaced)`,
      isError: false
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
