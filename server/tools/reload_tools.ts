import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { getToolContext } from "../tools-loader.ts";

export const { definition, executor } = createTool(
  {
    name: "reload_tools",
    description: "Reload tool definitions after editing files in server/tools/. New tools will be available on next use.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  (): ToolResult => {
    const { invalidateTools } = getToolContext();
    invalidateTools();
    return {
      content: "Tools cache cleared. New definitions will load on next use.",
      isError: false,
    };
  }
);
