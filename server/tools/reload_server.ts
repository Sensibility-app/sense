import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { log } from "../logger.ts";
import { getToolContext } from "../tools-loader.ts";

export const { definition, executor } = createTool(
  {
    name: "reload_server",
    description: "Restart the server after editing server-side TypeScript files (server/*.ts except tools). Validates syntax first. Task auto-resumes after restart.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async (): Promise<ToolResult> => {
    log("reload_server: Validating syntax...");
    
    const check = await new Deno.Command("deno", {
      args: ["check", "server/main.ts"],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (check.code !== 0) {
      const stderr = new TextDecoder().decode(check.stderr);
      return {
        content: `Syntax validation failed. Fix these errors:\n\n${stderr}`,
        isError: true,
      };
    }

    log("reload_server: Validation passed, scheduling restart...");
    
    setTimeout(async () => {
      log("reload_server: Saving session before restart...");
      await getToolContext().session.shutdown();
      log("reload_server: Exiting for restart...");
      Deno.exit(0);
    }, 100);

    return {
      content: "Validation passed. Server restarting... task will auto-resume.",
      isError: false,
    };
  }
);
