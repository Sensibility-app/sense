import { createTool, type ToolResult } from "./_shared/tool-utils.ts";
import { loadTools } from "../tools-loader.ts";

export const { definition, executor } = createTool(
  {
    name: "help",
    description: "List all available tools/commands with their descriptions.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  async (): Promise<ToolResult> => {
    const tools = await loadTools();

    const lines = tools
      .sort((a, b) => a.definition.name.localeCompare(b.definition.name))
      .map((t) => {
        const firstSentence = t.definition.description.split(".")[0];
        return `/${t.definition.name} - ${firstSentence}`;
      });

    return {
      content: `Available commands:\n\n${lines.join("\n")}`,
      isError: false,
    };
  },
);
