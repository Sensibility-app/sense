/**
 * Tool Formatter - Generates markdown representations of tool executions
 * Formats tool calls with HTML <details>/<summary> tags for collapsible rendering
 */

export interface ToolExecutionData {
  toolName: string;
  toolId: string;
  toolInput: unknown;
  toolResult: string;
  isError: boolean;
}

/**
 * Format tool input parameters for inline display in summary
 * Example: (path="app.ts", limit=100)
 */
export function formatToolParams(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  const params = Object.entries(toolInput as Record<string, unknown>)
    .map(([key, value]) => {
      if (typeof value === "string") {
        // Escape quotes in string values
        const escaped = value.replace(/"/g, '\\"');
        return `${key}="${escaped}"`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(", ");

  return params ? `(${params})` : "";
}

/**
 * Format tool input for detailed display in expanded view
 * Returns markdown with bold labels and code blocks for complex values
 */
export function formatToolInputForDisplay(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== "object") {
    return `\`\`\`json\n${JSON.stringify(toolInput, null, 2)}\n\`\`\``;
  }

  let output = "";
  for (const [key, value] of Object.entries(toolInput as Record<string, unknown>)) {
    if (typeof value === "string" && value.includes("\n")) {
      // Multi-line string - display it in a code block
      output += `**${key}:**\n\`\`\`\n${value}\n\`\`\`\n\n`;
    } else if (typeof value === "string") {
      // Single line string
      output += `**${key}:** \`${value}\`\n\n`;
    } else {
      // Non-string - use JSON
      output += `**${key}:** \`${JSON.stringify(value)}\`\n\n`;
    }
  }
  return output.trim();
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

/**
 * Format a complete tool execution as markdown with HTML <details>/<summary> tags
 * Creates a collapsible section showing tool name, input, and output
 */
export function formatToolAsMarkdown(data: ToolExecutionData): string {
  const { toolName, toolInput, toolResult, isError } = data;

  // Format parameters for summary line
  const params = formatToolParams(toolInput);
  const errorClass = isError ? ' class="tool-error"' : "";

  // Format the detailed input display
  const inputDisplay = formatToolInputForDisplay(toolInput);

  // Format the output - wrap in code block and escape if needed
  const outputLabel = isError ? "**Output (Error):**" : "**Output:**";
  const outputDisplay = `\`\`\`\n${toolResult}\n\`\`\``;

  // Construct the complete markdown block
  const markdown = `<details${errorClass}>
<summary>${toolName}${params}</summary>

**Input:**
${inputDisplay}

${outputLabel}
${outputDisplay}

</details>`;

  return markdown;
}
