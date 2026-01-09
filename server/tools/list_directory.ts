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
  description: "List directory contents (dirs marked with /)",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (default: '.')" },
    },
    required: [],
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  try {
    // Default to current directory if path not provided or empty
    const pathInput = (input.path && typeof input.path === "string" && input.path.trim())
      ? input.path.trim()
      : ".";

    if (typeof pathInput !== "string") {
      return {
        content: `Path must be a string, received "${typeof pathInput}". Use "." for current directory, or specify a subdirectory like "client" or "server".`,
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
