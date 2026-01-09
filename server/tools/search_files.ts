/**
 * search_files tool - Search for pattern in files
 *
 * Searches for text patterns in files using native Deno APIs. Returns matching lines
 * with file paths and line numbers.
 */

import { walk } from "jsr:@std/fs@^1.0.0";
import { relative } from "jsr:@std/path@^1.0.0";
import { createTool, PERMISSIONS, ToolResult, isBinaryFile, SKIP_DIRECTORY_PATTERNS } from "../tools/_shared/tool-utils.ts";
import { getBaseDir, resolveSearchPath } from "../tools/_shared/sanitize.ts";
import { SEARCH_RESULT_LIMIT, SEARCH_CONTENT_LIMIT } from "../constants.ts";

export const { definition, permissions, executor } = createTool(
  {
    name: "search_files",
    description: "Search for a text pattern in files. Returns matching lines with file paths and line numbers. Supports both literal strings and regex patterns. Useful for finding where code, text, or patterns appear in the codebase.",
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
          description: "Path to search within project, relative to project root (e.g., 'server', 'client', or '/' for entire project)",
          default: "/"
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  PERMISSIONS.READ_ONLY,
  async (input): Promise<ToolResult> => {
    const baseDir = getBaseDir();
    const pattern = input.pattern as string;
    const absoluteSearchPath = resolveSearchPath(input.search_path as string | undefined);

    // Create regex from pattern (support both literal and regex)
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i"); // Case insensitive
    } catch {
      // If regex fails, treat as literal string
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, "i");
    }

    const matches: string[] = [];
    let totalMatches = 0;
    let outputSize = 0;

    // Walk directory tree and search files
    for await (const entry of walk(absoluteSearchPath, {
      includeFiles: true,
      includeDirs: false,
      skip: SKIP_DIRECTORY_PATTERNS,
    })) {
      // Skip binary files
      if (isBinaryFile(entry.path)) {
        continue;
      }

      try {
        const content = await Deno.readTextFile(entry.path);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            totalMatches++;

            // Stop if we've hit the result limit
            if (totalMatches > SEARCH_RESULT_LIMIT) {
              matches.push(`\n... [${totalMatches - SEARCH_RESULT_LIMIT} more matches truncated]`);
              break;
            }

            // Format like grep: filename:linenumber:line
            const relativePath = "/" + relative(baseDir, entry.path);
            const match = `${relativePath}:${i + 1}:${lines[i]}`;

            outputSize += match.length + 1; // +1 for newline

            // Stop if output is too large
            if (outputSize > SEARCH_CONTENT_LIMIT) {
              matches.push(`\n... [output truncated at ${SEARCH_CONTENT_LIMIT} characters]`);
              break;
            }

            matches.push(match);
          }
        }

        // Break outer loop if limits reached
        if (totalMatches > SEARCH_RESULT_LIMIT || outputSize > SEARCH_CONTENT_LIMIT) {
          break;
        }
      } catch {
        // Skip files that can't be read (binary, permissions, etc.)
        continue;
      }
    }

    if (matches.length === 0) {
      return {
        content: `No matches found for pattern: ${pattern}`,
        isError: false,
      };
    }

    return {
      content: matches.join('\n'),
      isError: false,
    };
  }
);
