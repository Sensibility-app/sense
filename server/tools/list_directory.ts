/**
 * list_directory tool - List directory contents
 *
 * Lists files and directories with type indicators (dirs marked with /).
 * Applies entry limits to prevent context explosion.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";
import { MAX_DIRECTORY_ENTRIES } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "list_directory",
  description: "List contents of a directory in the project. Directories are marked with trailing slash (/). Sorted with directories first, then files alphabetically.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      dir_path: {
        type: "string",
        description: "Absolute path to directory within project (use '/' for project root, '/server' for server directory, etc.)",
        default: "/"
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  try {
    // Default to root directory if path not provided or empty
    const pathInput = (input.dir_path && typeof input.dir_path === "string" && input.dir_path.trim())
      ? input.dir_path.trim()
      : "/";

    if (typeof pathInput !== "string") {
      return {
        content: `dir_path must be a string, received "${typeof pathInput}". Use "/" for project root, or specify a subdirectory like "/client" or "/server".`,
        isError: true,
      };
    }

    // Sanitize path to prevent traversal attacks
    const path = sanitizePath(pathInput);

    // Read directory entries
    const entries: Array<{name: string; isDir: boolean}> = [];
    for await (const entry of Deno.readDir(path)) {
      entries.push({
        name: entry.name,
        isDir: entry.isDirectory
      });
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    // Format with type indicators
    const formatted = entries.map(e =>
      e.isDir ? `${e.name}/` : e.name
    );

    // Limit to prevent huge directories from exploding context
    if (formatted.length > MAX_DIRECTORY_ENTRIES) {
      const truncated = formatted.slice(0, MAX_DIRECTORY_ENTRIES);
      return {
        content: `Directories end with /. To explore a directory, call list_directory with its path (e.g., "client" or "server").\n\n` +
          truncated.join("\n") + `\n\n... [${formatted.length - MAX_DIRECTORY_ENTRIES} more entries truncated]`,
        isError: false
      };
    }

    return {
      content: `Directories end with /. To explore a directory, call list_directory with its path (e.g., "client" or "server").\n\n` +
        formatted.join("\n"),
      isError: false
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};
