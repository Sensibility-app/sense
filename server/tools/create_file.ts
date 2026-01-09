/**
 * create_file tool - Create new file
 *
 * Creates a new file with the specified content. Fails if file already exists.
 * Automatically creates parent directories if needed.
 */

import { dirname } from "jsr:@std/path@^1.0.0";
import { ToolDefinition, ToolExecutor, ToolResult, withErrorHandling, PERMISSIONS, validateInput } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const permissions = PERMISSIONS.WRITE_ONLY;

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

const executorImpl: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate input using shared helper
  const validationError = validateInput(input, definition.input_schema);
  if (validationError) return validationError;

  // Sanitize path to prevent traversal attacks
  const path = sanitizePath(input.file_path as string);

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
  await Deno.writeTextFile(path, input.file_contents as string);

  return { content: `Successfully created ${input.file_path}`, isError: false };
};

// Wrap executor with automatic error handling
export const executor: ToolExecutor = withErrorHandling(executorImpl);
