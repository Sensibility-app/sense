/**
 * glob tool - Find files by pattern
 *
 * Finds files matching glob patterns like *.ts or star-star-slash-star.js
 * Returns file paths sorted by modification time.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizeErrorMessage, getBaseDir } from "../tools/_shared/sanitize.ts";
import { expandGlob } from "jsr:@std/fs@1.0.21/expand-glob";
import { relative } from "jsr:@std/path@1.1.4/relative";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

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

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  if (!input.pattern || typeof input.pattern !== "string") {
    return {
      content: "pattern is required and must be a string",
      isError: true,
    };
  }

  try {
    const baseDir = getBaseDir();
    const searchPath = input.path
      ? baseDir + (input.path.startsWith('/') ? input.path.slice(1) : input.path)
      : baseDir;

    const matches: Array<{ path: string; mtime: number }> = [];
    
    for await (const entry of expandGlob(input.pattern, {
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
  } catch (error) {
    return {
      content: sanitizeErrorMessage(error),
      isError: true,
    };
  }
};
