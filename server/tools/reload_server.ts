/**
 * reload_server tool - Trigger server reload
 *
 * Triggers a server reload by touching main.ts to trigger Deno's watch mode.
 * Use this after modifying server code or creating new tools.
 */

import { join } from "jsr:@std/path@^1.0.0";
import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { getBaseDir } from "../tools/_shared/sanitize.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read", "write"],
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "reload_server",
  description: "Reload server to apply code changes",
  input_schema: {
    type: "object",
    properties: {},
    required: [],
  },
};

export const executor: ToolExecutor = async (_input): Promise<ToolResult> => {
  try {
    // Touch main.ts to trigger Deno's watch mode reload
    const mainPath = join(getBaseDir(), "server", "main.ts");

    // Verify file exists
    await Deno.stat(mainPath);

    // Update the file's access and modification times to trigger reload
    const now = new Date();
    await Deno.utime(mainPath, now, now);

    return {
      content: "Server reload triggered. The server will restart in watch mode and apply all code changes. This may take a few seconds.",
      isError: false,
    };
  } catch (error) {
    return {
      content: `Failed to trigger reload: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
};
