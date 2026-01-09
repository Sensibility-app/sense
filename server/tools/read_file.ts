/**
 * read_file tool - Read file contents
 *
 * Reads text files from the filesystem with size limits to prevent
 * context explosion.
 */

import { ToolDefinition, ToolExecutor, ToolResult, withErrorHandling, PERMISSIONS, validateInput } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";
import { MAX_FILE_SIZE_CHARS } from "../constants.ts";

export const permissions = PERMISSIONS.READ_ONLY;

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

const executorImpl: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate input using shared helper
  const validationError = validateInput(input, definition.input_schema);
  if (validationError) return validationError;

  // Sanitize path to prevent traversal attacks
  const path = sanitizePath(input.file_path as string);

  // Read file content
  let content = await Deno.readTextFile(path);

  // Handle offset/limit if provided
  if (input.offset !== undefined || input.limit !== undefined) {
    const lines = content.split("\n");
    const startLine = Math.max(0, ((input.offset as number) || 1) - 1);
    const endLine = input.limit !== undefined
      ? startLine + (input.limit as number)
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
};

// Wrap executor with automatic error handling
export const executor: ToolExecutor = withErrorHandling(executorImpl);
