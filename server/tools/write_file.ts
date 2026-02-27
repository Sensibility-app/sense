/**
 * write_file tool - Write content to a file
 *
 * Writes content to a file, creating it if it doesn't exist or overwriting if it does.
 * Automatically creates parent directories if needed.
 */

import { dirname } from "jsr:@std/path@^1.0.0";
import { createTool, type ToolResult } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

export const { definition, executor } = createTool(
  {
    name: "write_file",
    description: "Write content to a file, creating it if it doesn't exist or overwriting if it does. Use for full file rewrites. Automatically creates parent directories.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to file relative to project root (e.g., 'server/tools/new_tool.ts')"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        },
      },
      required: ["file_path", "content"],
    },
  },
  async (input): Promise<ToolResult> => {
    const path = sanitizePath(input.file_path as string);

    // Create parent directories if needed
    await Deno.mkdir(dirname(path), { recursive: true });

    // Write file (creates or overwrites)
    await Deno.writeTextFile(path, input.content as string);

    return { content: `Successfully wrote to ${input.file_path}`, isError: false };
  }
);
