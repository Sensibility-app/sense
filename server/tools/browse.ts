import { browse } from "browse";
import { createTool, type ToolResult } from "./_shared/tool-utils.ts";

export const { definition, executor } = createTool(
  {
    name: "browse",
    description:
      "Control a headless browser. Actions: navigate (go to URL), view_self (open your own app), " +
      "text (extract page text), snapshot (accessibility tree), screenshot (visual JPEG capture — you can see the image), " +
      "click/type/fill/press/hover/scroll/select (interact with elements by ref), " +
      "evaluate (run JS expression in page — no 'return' statements, use JSON.stringify() for objects), tabs (list open tabs). " +
      "For visual verification: use screenshot to SEE the page. " +
      "Typical flow: navigate → snapshot (get refs) → click/type/fill → screenshot or text (verify result).",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Browser action: navigate, view_self, text, snapshot, screenshot, click, type, fill, press, hover, scroll, select, evaluate, tabs",
          enum: [
            "navigate", "view_self", "text", "snapshot", "screenshot",
            "click", "type", "fill", "press", "hover", "scroll", "select",
            "evaluate", "tabs",
          ],
        },
        url: {
          type: "string",
          description: "URL to navigate to (for 'navigate' action)",
        },
        ref: {
          type: "string",
          description: "Element ref from snapshot (for click/type/fill/hover/select)",
        },
        text: {
          type: "string",
          description: "Text to type (for 'type' action)",
        },
        value: {
          type: "string",
          description: "Value to fill or select (for 'fill'/'select' actions)",
        },
        key: {
          type: "string",
          description: "Key to press (for 'press' action, e.g. 'Enter', 'Tab')",
        },
        expression: {
          type: "string",
          description: "JavaScript expression to evaluate in page (for 'evaluate' action — NO 'return' statements, use JSON.stringify() to return objects)",
        },
        filter: {
          type: "string",
          description: "Snapshot filter: 'interactive' (form elements only) or 'all' (default)",
        },
        scrollX: {
          type: "number",
          description: "Horizontal scroll pixels (for 'scroll' action)",
        },
        scrollY: {
          type: "number",
          description: "Vertical scroll pixels (for 'scroll' action)",
        },
        direction: {
          type: "string",
          description: "Scroll shortcut (for 'scroll' action): up (500px), down (500px), top, bottom",
          enum: ["up", "down", "top", "bottom"],
        },
      },
      required: ["action"],
    },
  },
  async (input): Promise<ToolResult> => {
    const action = input.action as string;

    switch (action) {
      case "navigate": {
        if (!input.url) return { content: "url is required for navigate", isError: true };
        const result = await browse.navigate(input.url as string);
        return { content: `Navigated to: ${result.title}\nURL: ${result.url}`, isError: false };
      }
      case "view_self": {
        const result = await browse.viewSelf();
        return { content: `Viewing self: ${result.title}\nURL: ${result.url}`, isError: false };
      }
      case "text": {
        const result = await browse.text();
        return { content: `[${result.title}] (${result.url})\n\n${result.text}`, isError: false };
      }
      case "snapshot": {
        const filter = input.filter as "interactive" | "all" | undefined;
        const result = await browse.snapshot({ filter, format: "compact" });
        const tree = JSON.stringify(result.nodes, null, 2);
        return { content: `[${result.title}] (${result.url})\n\n${tree}`, isError: false };
      }
      case "click": {
        if (!input.ref) return { content: "ref is required for click", isError: true };
        const result = await browse.click(input.ref as string);
        return { content: result.message || "Clicked", isError: !result.success };
      }
      case "type": {
        if (!input.ref) return { content: "ref is required for type", isError: true };
        if (!input.text) return { content: "text is required for type", isError: true };
        const result = await browse.type(input.ref as string, input.text as string);
        return { content: result.message || "Typed", isError: !result.success };
      }
      case "fill": {
        if (!input.ref) return { content: "ref is required for fill", isError: true };
        if (!input.value) return { content: "value is required for fill", isError: true };
        const result = await browse.fill(input.ref as string, input.value as string);
        return { content: result.message || "Filled", isError: !result.success };
      }
      case "press": {
        if (!input.key) return { content: "key is required for press", isError: true };
        const result = await browse.press(input.key as string);
        return { content: result.message || `Pressed ${input.key}`, isError: !result.success };
      }
      case "hover": {
        if (!input.ref) return { content: "ref is required for hover", isError: true };
        const result = await browse.hover(input.ref as string);
        return { content: result.message || "Hovered", isError: !result.success };
      }
      case "scroll": {
        if (input.direction) {
          const dir = input.direction as string;
          const expressions: Record<string, string> = {
            up: "window.scrollBy(0, -500)",
            down: "window.scrollBy(0, 500)",
            top: "window.scrollTo(0, 0)",
            bottom: "window.scrollTo(0, document.body.scrollHeight)",
          };
          const expr = expressions[dir];
          if (!expr) return { content: `Unknown direction: ${dir}`, isError: true };
          await browse.evaluate(expr);
          return { content: `Scrolled ${dir}`, isError: false };
        }
        const x = Number(input.scrollX ?? 0);
        const y = Number(input.scrollY ?? 0);
        const result = await browse.scroll(x, y);
        return { content: result.message || `Scrolled (${x}, ${y})`, isError: false };
      }
      case "select": {
        if (!input.ref) return { content: "ref is required for select", isError: true };
        if (!input.value) return { content: "value is required for select", isError: true };
        const result = await browse.select(input.ref as string, input.value as string);
        return { content: result.message || "Selected", isError: !result.success };
      }
      case "evaluate": {
        if (!input.expression) return { content: "expression is required for evaluate", isError: true };
        const result = await browse.evaluate(input.expression as string);
        return { content: JSON.stringify(result.result, null, 2), isError: false };
      }
      case "tabs": {
        const result = await browse.tabs();
        if (result.tabs.length === 0) return { content: "No open tabs", isError: false };
        const lines = result.tabs.map((t: { id: string; url: string; title: string }) => `  [${t.id}] ${t.title} — ${t.url}`);
        return { content: `Open tabs:\n${lines.join("\n")}`, isError: false };
      }
      case "screenshot": {
        const result = await browse.screenshot();
        return {
          content: [
            { type: "text", text: "Screenshot captured" },
            { type: "image", source: { type: "base64", media_type: result.contentType, data: result.data } },
          ],
          isError: false,
        };
      }
      default:
        return { content: `Unknown action: ${action}`, isError: true };
    }
  },
);
