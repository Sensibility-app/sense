import { createTool, PERMISSIONS, ToolResult } from "./_shared/tool-utils.ts";
import { getToolContext } from "../tools-loader.ts";

export const { definition, permissions, executor } = createTool(
  {
    name: "reload_client",
    description: "Refresh the browser after editing client-side code (client/*.ts, shared/*.ts, CSS, HTML).",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  PERMISSIONS.READ_ONLY,
  (): ToolResult => {
    const { broadcast } = getToolContext();
    broadcast({ type: "reload_page", reason: "Client code updated" });
    return {
      content: "Browser refresh triggered.",
      isError: false,
    };
  }
);
