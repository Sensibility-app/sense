/**
 * search_files tool - Search for pattern in files
 *
 * Searches for text patterns in files using grep. Returns matching lines
 * with file paths and line numbers.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { getBaseDir } from "../tools/_shared/sanitize.ts";
import { SEARCH_RESULT_LIMIT, SEARCH_CONTENT_LIMIT } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: true,
};

export const definition: ToolDefinition = {
  name: "search_files",
  description: "Search for a text pattern in files using grep. Returns matching lines with file paths and line numbers. Useful for finding where code, text, or patterns appear in the codebase.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The text pattern to search for (supports regex patterns)"
      },
      search_path: {
        type: "string",
        description: "Absolute path to search within project (default: '/' for entire project)",
        default: "/"
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate pattern
  if (!input.pattern || typeof input.pattern !== "string") {
    return {
      content: "Pattern is required and must be a string",
      isError: true,
    };
  }

  try {
    // Default to root directory if path not provided
    const searchPath = input.search_path || "/";

    // Execute grep command
    const process = new Deno.Command("grep", {
      args: ["-r", "-n", input.pattern, searchPath as string],
      cwd: getBaseDir(),
      stdout: "piped",
      stderr: "piped",
    });

    const { stdout, stderr } = await process.output();
    let output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    // Limit output to prevent context explosion
    const lines = output.split('\n');

    if (lines.length > SEARCH_RESULT_LIMIT) {
      output = lines.slice(0, SEARCH_RESULT_LIMIT).join('\n') +
        `\n\n... [${lines.length - SEARCH_RESULT_LIMIT} more matches truncated]`;
    } else if (output.length > SEARCH_CONTENT_LIMIT) {
      output = output.slice(0, SEARCH_CONTENT_LIMIT) +
        `\n\n... [output truncated at ${SEARCH_CONTENT_LIMIT} characters]`;
    }

    return {
      content: output || errorOutput || "No matches found",
      isError: false,
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
