import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { getToolContext } from "../tools-loader.ts";
import { archiveCurrentSession } from "../persistent-session.ts";

export const { definition, executor } = createTool(
  {
    name: "clear",
    description: "Clear the current session and start fresh. Archives the current session first.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async (): Promise<ToolResult> => {
    const { session, broadcast } = getToolContext();

    await archiveCurrentSession();
    await session.clear();

    broadcast({ type: "reload_page", reason: "Session cleared" });

    return {
      content: "Session cleared. Refreshing the page...",
      isError: false,
    };
  },
);
