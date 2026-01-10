/**
 * glob tool - Find files by pattern
 *
 * Finds files matching glob patterns like *.ts or star-star-slash-star.js
 * Returns file paths sorted by modification time.
 * Respects .gitignore by default.
 */

import { createTool, PERMISSIONS, ToolResult } from "../tools/_shared/tool-utils.ts";
import { getBaseDir, resolveSearchPath } from "../tools/_shared/sanitize.ts";
import { expandGlob } from "jsr:@std/fs@1.0.21/expand-glob";
import { relative } from "jsr:@std/path@1.1.4/relative";
import { join } from "jsr:@std/path@1.1.4/join";
import { compile } from "jsr:@cfa/gitignore-parser";


/**
 * Load and parse .gitignore files
 */
async function loadGitignore(baseDir: string) {
  let gitignoreContent = ".git\n"; // Always ignore .git directory

  try {
    const gitignorePath = join(baseDir, ".gitignore");
    const content = await Deno.readTextFile(gitignorePath);
    gitignoreContent += content;
  } catch {
    // No .gitignore file, use default
  }

  return compile(gitignoreContent);
}

export const { definition, permissions, executor } = createTool(
  {
    name: "glob",
    description: "Find files matching glob patterns. Supports *.ts, **/*.js, etc. Returns paths sorted by modification time. Respects .gitignore by default.",
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
        include_gitignored: {
          type: "boolean",
          description: "Optional: Include files that are gitignored (default: false). Set to true to search everything including node_modules, dist, .env, etc."
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  PERMISSIONS.READ_ONLY,
  async (input): Promise<ToolResult> => {
    const baseDir = getBaseDir();
    const searchPath = resolveSearchPath(input.path as string | undefined);
    const includeGitignored = input.include_gitignored === true;

    // Load .gitignore if not including gitignored files
    const ig = includeGitignored ? null : await loadGitignore(baseDir);

    const matches: Array<{ path: string; mtime: number }> = [];

    for await (const entry of expandGlob(input.pattern as string, {
      root: searchPath,
      includeDirs: false,
      globstar: true,
    })) {
      const stat = await Deno.stat(entry.path);
      const relativePath = relative(baseDir, entry.path);

      // Skip if gitignored (unless include_gitignored is true)
      if (ig && ig.denies(relativePath)) {
        continue;
      }

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
  }
);
