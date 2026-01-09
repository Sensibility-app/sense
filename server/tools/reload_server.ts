/**
 * reload_server tool - Trigger server reload
 *
 * Triggers a server reload by touching main.ts to trigger Deno's watch mode.
 * Use this after modifying server code or creating new tools.
 */

import { join } from "jsr:@std/path@^1.0.0";
import { createTool, PERMISSIONS, ToolResult } from "../tools/_shared/tool-utils.ts";
import { getBaseDir } from "../tools/_shared/sanitize.ts";

export const { definition, permissions, executor } = createTool(
  {
    name: "reload_server",
    description: "Trigger a server reload to apply code changes immediately. The server will restart in watch mode and pick up all modifications to server files. Useful after creating new tools or modifying server code.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  PERMISSIONS.READ_WRITE,
  async (input): Promise<ToolResult> => {
    // Touch main.ts to trigger Deno's watch mode reload
    const mainPath = join(getBaseDir(), "server", "main.ts");

    // Verify file exists
    await Deno.stat(mainPath);

    // Update the file's access and modification times to trigger reload
    const now = new Date();
    await Deno.utime(mainPath, now, now);

    return {
      content: "Server reload triggered. The server will restart and automatically resume this task with full context.",
      isError: false,
    };
  }
);
