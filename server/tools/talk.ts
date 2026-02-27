import { discover, self, sendMessage } from "talk";
import { createTool, type ToolResult } from "./_shared/tool-utils.ts";

export const { definition, executor } = createTool(
  {
    name: "talk",
    description:
      `Send a message to another Sense app or yourself. All sibling apps are discoverable as sockets in /run/apps/. ` +
      `Use target "self" for self-talk — goes through your own socket, so it doubles as a self-test. ` +
      `Use target "list" to discover available apps.`,
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            'App name to talk to, "self" for self-talk through your own socket, or "list" to discover available apps',
        },
        message: {
          type: "string",
          description: "Message to send (required when target is not 'list')",
        },
      },
      required: ["target"],
    },
  },
  async (input): Promise<ToolResult> => {
    const target = input.target as string;
    const message = input.message as string | undefined;

    if (target === "list") {
      const apps = await discover();
      if (apps.length === 0) {
        return {
          content:
            "No sibling apps found in /run/apps/. You may be running in local dev mode, or you're the only app for this user.",
          isError: false,
        };
      }
      const me = self();
      const selfMarker = (name: string) => name === me ? " (you)" : "";
      return {
        content: `Available apps:\n${apps.map((a: string) => `  - ${a}${selfMarker(a)}`).join("\n")}`,
        isError: false,
      };
    }

    if (!message?.trim()) {
      return { content: "message is required when target is not 'list'", isError: true };
    }

    const isSelf = target === "self" || target === self();
    const result = await sendMessage(target, message);
    const label = isSelf ? "Self-talk response" : `Response from ${result.from}`;
    return {
      content: `[${label}]:\n${result.response}`,
      isError: false,
    };
  },
);
