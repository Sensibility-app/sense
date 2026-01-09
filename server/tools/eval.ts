/**
 * eval tool - Execute TypeScript/JavaScript code
 *
 * Executes code with full access to Deno APIs. Security is enforced
 * by Deno's permission system (server already runs with restricted permissions).
 */

import { createTool, PERMISSIONS, ToolResult } from "../tools/_shared/tool-utils.ts";

export const { definition, permissions, executor } = createTool(
  {
    name: "eval",
    description: "Execute TypeScript/JavaScript code with access to Deno APIs (Deno.readDir, Deno.readTextFile, etc.). Code runs with server's permission context.",
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "TypeScript/JavaScript code to execute. Can use await, Deno APIs, return values. Example: 'return await Deno.readTextFile(\"/server/main.ts\")'"
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
  PERMISSIONS.EXECUTE,
  async (input): Promise<ToolResult> => {
    // Create async function from code
    const asyncFn = new Function("Deno", `
      return (async () => {
        ${input.code}
      })();
    `);

    // Execute with timeout (10 seconds)
    const timeoutMs = 10000;
    const result = await Promise.race([
      asyncFn(Deno),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Execution timeout (10s)")), timeoutMs)
      ),
    ]);

    // Format result
    const output = result !== undefined
      ? (typeof result === "string" ? result : JSON.stringify(result, null, 2))
      : "Code executed successfully (no return value)";

    return {
      content: output,
      isError: false,
    };
  }
);
