import { createTool, type ToolResult } from "../tools/_shared/tool-utils.ts";
import { sanitizePath } from "../tools/_shared/sanitize.ts";

function countOccurrences(str: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

interface EditOp {
  old_str: string;
  new_str: string;
  replace_all?: boolean;
}

function applyEdit(
  content: string,
  edit: EditOp,
  filePath: string,
): { content: string; replacements: number; error?: string } {
  if (edit.old_str === edit.new_str) {
    return { content, replacements: 0, error: "old_str and new_str must be different." };
  }

  const matchCount = countOccurrences(content, edit.old_str);

  if (matchCount === 0) {
    return {
      content,
      replacements: 0,
      error: `No match found for replacement in ${filePath}. Make sure old_str matches exactly (including whitespace).`,
    };
  }

  if (!edit.replace_all && matchCount > 1) {
    return {
      content,
      replacements: 0,
      error: `Found ${matchCount} matches of string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more context to uniquely identify the instance.`,
    };
  }

  const newContent = edit.replace_all
    ? content.replaceAll(edit.old_str, edit.new_str)
    : content.replace(edit.old_str, edit.new_str);

  return { content: newContent, replacements: edit.replace_all ? matchCount : 1 };
}

export const { definition, executor } = createTool(
  {
    name: "edit_file",
    description:
      "Edit a file by replacing exact string matches. Supports single replacement (old_str/new_str) or multiple replacements in one call via the `edits` array. Each edit requires unique match by default; use replace_all=true per edit to replace all occurrences. Use `edits` when making multiple non-contiguous changes to the same file — all edits run in one tool call.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to file relative to project root (e.g., 'server/main.ts')",
        },
        old_str: {
          type: "string",
          description: "The exact string to find and replace (single edit mode)",
        },
        new_str: {
          type: "string",
          description: "The replacement text (single edit mode)",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace all occurrences instead of requiring unique match (default: false)",
        },
        edits: {
          type: "array",
          description:
            "Array of edits to apply sequentially (multi-edit mode). Use instead of old_str/new_str for multiple changes to the same file in one call.",
          items: {
            type: "object",
            properties: {
              old_str: { type: "string", description: "The exact string to find" },
              new_str: { type: "string", description: "The replacement text" },
              replace_all: {
                type: "boolean",
                description: "Replace all occurrences (default: false)",
              },
            },
            required: ["old_str", "new_str"],
          },
        },
      },
      required: ["file_path"],
    },
  },
  async (input): Promise<ToolResult> => {
    const filePath = input.file_path as string;
    const path = sanitizePath(filePath);

    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch {
      return {
        content: `File not found: ${filePath}. Use create_file to create new files.`,
        isError: true,
      };
    }

    const edits: EditOp[] = [];
    if (input.edits && Array.isArray(input.edits)) {
      for (const e of input.edits as Array<Record<string, unknown>>) {
        edits.push({
          old_str: e.old_str as string,
          new_str: e.new_str as string,
          replace_all: (e.replace_all as boolean) ?? false,
        });
      }
    } else if (input.old_str !== undefined && input.new_str !== undefined) {
      edits.push({
        old_str: input.old_str as string,
        new_str: input.new_str as string,
        replace_all: (input.replace_all as boolean) ?? false,
      });
    } else {
      return {
        content: "Provide either old_str/new_str or edits array.",
        isError: true,
      };
    }

    if (edits.length === 0) {
      return { content: "No edits provided.", isError: true };
    }

    let totalReplacements = 0;
    for (let i = 0; i < edits.length; i++) {
      const result = applyEdit(content, edits[i], filePath);
      if (result.error) {
        const prefix = edits.length > 1 ? `Edit ${i + 1}/${edits.length}: ` : "";
        return { content: `${prefix}${result.error}`, isError: true };
      }
      content = result.content;
      totalReplacements += result.replacements;
    }

    await Deno.writeTextFile(path, content);

    const msg =
      edits.length === 1
        ? `Successfully edited ${filePath} (${totalReplacements} replacement${totalReplacements > 1 ? "s" : ""})`
        : `Successfully edited ${filePath} (${edits.length} edits, ${totalReplacements} total replacements)`;
    return { content: msg, isError: false };
  },
);
