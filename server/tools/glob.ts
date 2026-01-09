/**
 * glob tool - Find files by pattern
 *
 * Finds files matching glob patterns like *.ts or star-star-slash-star.js
 * Returns file paths sorted by modification time.
 */

import { ToolDefinition, ToolExecutor, ToolResult, withErrorHandling, PERMISSIONS, validateInput } from "../tools/_shared/tool-utils.ts";
import { getBaseDir, resolveSearchPath } from "../tools/_shared/sanitize.ts";
import { expandGlob } from "jsr:@std/fs@1.0.21/expand-glob";
import { relative } from "jsr:@std/path@1.1.4/relative";

export const permissions = PERMISSIONS.READ_ONLY;

export const definition: ToolDefinition = {
  name: "glob",
  description: "Find files matching glob patterns. Supports *.ts, **/*.js, etc. Returns paths sorted by modification time.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match (e.g., '*.ts', '**/*.js', 'server/**/*.ts')"
      },
      path: {
        type: "string",
        description: "Optional: Base directory to search from (default: project root '/'. Example: '/server')"
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
};

const executorImpl: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate input using shared helper
  const validationError = validateInput(input, definition.input_schema);
  if (validationError) return validationError;

  const baseDir = getBaseDir();
  const searchPath = resolveSearchPath(input.path as string | undefined);

  const matches: Array<{ path: string; mtime: number }> = [];

  for await (const entry of expandGlob(input.pattern as string, {
    root: searchPath,
    includeDirs: false,
    globstar: true,
  })) {
    const stat = await Deno.stat(entry.path);
    const relativePath = relative(baseDir, entry.path);

    matches.push({
      path: "/" + relativePath,
      mtime: stat.mtime?.getTime() || 0,
    });
  }

  matches.sort((a, b) => b.mtime - a.mtime);

  if (matches.length === 0) {
    return {
      content: "No files found matching pattern: " + input.pattern,
      isError: false,
    };
  }

  const paths = matches.map(m => m.path).join("\n");
  const summary = "Found " + matches.length + " file" + (matches.length === 1 ? '' : 's') + " matching '" + input.pattern + "':\n" + paths;

  return {
    content: summary,
    isError: false,
  };
};

// Wrap executor with automatic error handling
export const executor: ToolExecutor = withErrorHandling(executorImpl);
