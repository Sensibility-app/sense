import { createTool, PERMISSIONS, ToolResult } from "../tools/_shared/tool-utils.ts";
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

export const { definition, permissions, executor } = createTool(
  {
    name: "edit_file",
    description: "Edit a file by replacing an exact string match. By default, requires the string to appear exactly once (unique match). Use replace_all=true to replace all occurrences.",
    input_schema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to file relative to project root (e.g., 'server/main.ts')"
        },
        old_str: {
          type: "string",
          description: "The exact string to find and replace (must match exactly including whitespace)"
        },
        new_str: {
          type: "string",
          description: "The replacement text"
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences instead of requiring unique match (default: false)"
        },
      },
      required: ["file_path", "old_str", "new_str"],
    },
  },
  PERMISSIONS.READ_WRITE,
  async (input): Promise<ToolResult> => {
    const path = sanitizePath(input.file_path as string);
    const oldStr = input.old_str as string;
    const newStr = input.new_str as string;
    const replaceAll = input.replace_all as boolean ?? false;

    let content: string;
    try {
      content = await Deno.readTextFile(path);
    } catch {
      return {
        content: `File not found: ${input.file_path}. Use create_file to create new files.`,
        isError: true,
      };
    }

    if (oldStr === newStr) {
      return {
        content: "old_str and new_str must be different.",
        isError: true,
      };
    }

    const matchCount = countOccurrences(content, oldStr);

    if (matchCount === 0) {
      return {
        content: `No match found for replacement in ${input.file_path}. Make sure old_str matches exactly (including whitespace).`,
        isError: true,
      };
    }

    if (!replaceAll && matchCount > 1) {
      return {
        content: `Found ${matchCount} matches of string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, provide more context to uniquely identify the instance.`,
        isError: true,
      };
    }

    const newContent = replaceAll
      ? content.replaceAll(oldStr, newStr)
      : content.replace(oldStr, newStr);

    await Deno.writeTextFile(path, newContent);

    const replacedCount = replaceAll ? matchCount : 1;
    return {
      content: `Successfully edited ${input.file_path} (${replacedCount} replacement${replacedCount > 1 ? 's' : ''})`,
      isError: false
    };
  }
);
