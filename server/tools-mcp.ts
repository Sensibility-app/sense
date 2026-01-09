import { join, dirname } from "jsr:@std/path@^1.0.0";
import {
  MAX_FILE_SIZE_CHARS,
  MAX_DIRECTORY_ENTRIES,
  COMMAND_OUTPUT_LIMIT_CHARS,
  SEARCH_RESULT_LIMIT,
  SEARCH_CONTENT_LIMIT,
} from "./constants.ts";

const BASE_DIR = Deno.cwd();

// Ensure path is safe and within project
function sanitizePath(path: string): string {
  const resolved = join(BASE_DIR, path);
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

// Allowed commands for execute_command tool (security whitelist)
const ALLOWED_COMMANDS = new Set([
  "git", "deno", "npm", "node",
  "ls", "cat", "grep", "find",
  "echo", "pwd", "which", "whoami",
  "curl", "wget", "jq",
  "python", "python3", "ruby", "go", "cargo", "rustc"
]);

// Parse command string into command and arguments (handles quoted strings)
function parseCommand(commandString: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];
    const nextChar = commandString[i + 1];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else if (char === "\\" && nextChar && !inQuotes) {
      // Handle escaped characters outside quotes
      current += nextChar;
      i++; // Skip next character
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    throw new Error("Empty command");
  }

  const command = parts[0];
  const args = parts.slice(1);

  // Validate command is in whitelist
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Command '${command}' is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`);
  }

  return { command, args };
}

// MCP-style tool definitions for Claude (optimized for token efficiency)
export const TOOLS = [
  {
    name: "read_file",
    description: "Read file contents",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_file",
    description: "Create new file (fails if exists). Auto-creates parent dirs.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        content: { type: "string", description: "File content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact string match. Use edit_file_range for multi-line.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        old_string: { type: "string", description: "Text to replace (exact match)" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "read_file_range",
    description: "Read specific line range (1-indexed)",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        start_line: { type: "number", description: "Start line (1-indexed)" },
        end_line: { type: "number", description: "End line (-1 for EOF)" },
      },
      required: ["path", "start_line", "end_line"],
    },
  },
  {
    name: "edit_file_range",
    description: "Replace line range (1-indexed). Preferred for multi-line edits.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        start_line: { type: "number", description: "Start line (1-indexed)" },
        end_line: { type: "number", description: "End line (1-indexed)" },
        new_content: { type: "string", description: "Replacement content" },
      },
      required: ["path", "start_line", "end_line", "new_content"],
    },
  },
  {
    name: "list_directory",
    description: "List directory contents (dirs marked with /)",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: '.')" },
      },
      required: [],
    },
  },
  {
    name: "execute_command",
    description: "Execute shell command in project root",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for pattern in files (grep)",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern" },
        path: { type: "string", description: "Search path (default: '.')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "reload_server",
    description: "Reload server to apply code changes",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Execute a tool call
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case "read_file": {
        if (!input.path || typeof input.path !== "string") {
          return {
            content: "Path is required and must be a string",
            isError: true,
          };
        }
        const path = sanitizePath(input.path);
        let content = await Deno.readTextFile(path);

        // Limit file size to prevent context explosion
        if (content.length > MAX_FILE_SIZE_CHARS) {
          content = content.slice(0, MAX_FILE_SIZE_CHARS) +
            `\n\n... [file truncated at ${MAX_FILE_SIZE_CHARS} characters, total size: ${content.length} chars]`;
        }

        return { content, isError: false };
      }

      case "create_file": {
        if (!input.path || typeof input.path !== "string") {
          return {
            content: "Path is required and must be a string",
            isError: true,
          };
        }
        if (input.content === undefined || typeof input.content !== "string") {
          return {
            content: "Content is required and must be a string",
            isError: true,
          };
        }
        const path = sanitizePath(input.path);

        // Check if file already exists
        try {
          await Deno.stat(path);
          return {
            content: `File ${input.path} already exists. Use edit_file_range or edit_file to modify existing files.`,
            isError: true,
          };
        } catch {
          // File doesn't exist, we can create it
        }

        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, input.content);
        return { content: `Successfully created ${input.path}`, isError: false };
      }

      case "edit_file": {
        if (!input.path || typeof input.path !== "string") {
          return {
            content: "Path is required and must be a string",
            isError: true,
          };
        }
        if (!input.old_string || typeof input.old_string !== "string") {
          return {
            content: "old_string is required and must be a string",
            isError: true,
          };
        }
        if (input.new_string === undefined || typeof input.new_string !== "string") {
          return {
            content: "new_string is required and must be a string",
            isError: true,
          };
        }

        const path = sanitizePath(input.path);

        // Read current file content
        let content: string;
        try {
          content = await Deno.readTextFile(path);
        } catch {
          return {
            content: `File ${input.path} not found. Use create_file to create new files.`,
            isError: true,
          };
        }

        // Find and replace
        if (!content.includes(input.old_string)) {
          return {
            content: `String not found in ${input.path}. Make sure old_string matches exactly (including whitespace). Consider using edit_file_range for more reliable editing.`,
            isError: true,
          };
        }

        const newContent = content.replace(input.old_string, input.new_string);
        await Deno.writeTextFile(path, newContent);

        return {
          content: `Successfully edited ${input.path}`,
          isError: false
        };
      }

      case "read_file_range": {
        if (!input.path || typeof input.path !== "string") {
          return {
            content: "Path is required and must be a string",
            isError: true,
          };
        }
        if (typeof input.start_line !== "number" || typeof input.end_line !== "number") {
          return {
            content: "start_line and end_line are required and must be numbers",
            isError: true,
          };
        }

        const path = sanitizePath(input.path);
        const content = await Deno.readTextFile(path);
        const lines = content.split("\n");

        const startIdx = Math.max(0, input.start_line - 1);
        const endIdx = input.end_line === -1 ? lines.length : input.end_line;

        if (startIdx >= lines.length) {
          return {
            content: `start_line ${input.start_line} exceeds file length (${lines.length} lines)`,
            isError: true,
          };
        }

        const selectedLines = lines.slice(startIdx, endIdx);
        const result = selectedLines.map((line, idx) =>
          `${startIdx + idx + 1}: ${line}`
        ).join("\n");

        return { content: result, isError: false };
      }

      case "edit_file_range": {
        if (!input.path || typeof input.path !== "string") {
          return {
            content: "Path is required and must be a string",
            isError: true,
          };
        }
        if (typeof input.start_line !== "number" || typeof input.end_line !== "number") {
          return {
            content: "start_line and end_line are required and must be numbers",
            isError: true,
          };
        }
        if (input.new_content === undefined || typeof input.new_content !== "string") {
          return {
            content: "new_content is required and must be a string",
            isError: true,
          };
        }

        const path = sanitizePath(input.path);

        // Read current file content
        let content: string;
        try {
          content = await Deno.readTextFile(path);
        } catch {
          return {
            content: `File ${input.path} not found. Use create_file to create new files.`,
            isError: true,
          };
        }

        const lines = content.split("\n");
        const startIdx = input.start_line - 1; // Convert to 0-indexed
        const endIdx = input.end_line; // End is exclusive in slice

        // Validate line numbers
        if (startIdx < 0 || startIdx >= lines.length) {
          return {
            content: `start_line ${input.start_line} is out of range (file has ${lines.length} lines)`,
            isError: true,
          };
        }
        if (endIdx < startIdx || endIdx > lines.length) {
          return {
            content: `end_line ${input.end_line} is out of range (must be >= start_line and <= ${lines.length})`,
            isError: true,
          };
        }

        // Replace the line range
        const before = lines.slice(0, startIdx);
        const after = lines.slice(endIdx);
        const newLines = [...before, input.new_content, ...after];
        const newContent = newLines.join("\n");

        await Deno.writeTextFile(path, newContent);

        const replacedCount = endIdx - startIdx;
        return {
          content: `Successfully edited ${input.path} (replaced lines ${input.start_line}-${input.end_line}, ${replacedCount} lines replaced)`,
          isError: false
        };
      }

      case "list_directory": {
        // Default to current directory if path not provided or empty
        const pathInput = (input.path && typeof input.path === "string" && input.path.trim())
          ? input.path.trim()
          : ".";

        if (typeof pathInput !== "string") {
          return {
            content: `Path must be a string, received "${typeof pathInput}". Use "." for current directory, or specify a subdirectory like "client" or "server".`,
            isError: true,
          };
        }
        const path = sanitizePath(pathInput);
        const entries: Array<{name: string; isDir: boolean}> = [];
        for await (const entry of Deno.readDir(path)) {
          entries.push({
            name: entry.name,
            isDir: entry.isDirectory
          });
        }

        // Sort: directories first, then files
        entries.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });

        // Format with type indicators
        const formatted = entries.map(e =>
          e.isDir ? `${e.name}/` : e.name
        );

        // Limit to prevent huge directories from exploding context
        if (formatted.length > MAX_DIRECTORY_ENTRIES) {
          const truncated = formatted.slice(0, MAX_DIRECTORY_ENTRIES);
          return {
            content: `Directories end with /. To explore a directory, call list_directory with its path (e.g., "client" or "server").\n\n` +
              truncated.join("\n") + `\n\n... [${formatted.length - MAX_DIRECTORY_ENTRIES} more entries truncated]`,
            isError: false
          };
        }

        return {
          content: `Directories end with /. To explore a directory, call list_directory with its path (e.g., "client" or "server").\n\n` +
            formatted.join("\n"),
          isError: false
        };
      }

      case "execute_command": {
        if (!input.command || typeof input.command !== "string") {
          return {
            content: "Command is required and must be a string",
            isError: true,
          };
        }

        try {
          const { command, args } = parseCommand(input.command);
          const process = new Deno.Command(command, {
            args: args,
            cwd: BASE_DIR,
            stdout: "piped",
            stderr: "piped",
          });

          const { code, stdout, stderr } = await process.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);
          let combined = output + errorOutput;

          // Limit command output to prevent context explosion
          if (combined.length > COMMAND_OUTPUT_LIMIT_CHARS) {
            combined = combined.slice(0, COMMAND_OUTPUT_LIMIT_CHARS) +
              `\n\n... [output truncated at ${COMMAND_OUTPUT_LIMIT_CHARS} characters, total: ${combined.length} chars]`;
          }

          if (code !== 0) {
            return {
              content: `Command exited with code ${code}:\n${combined}`,
              isError: true,
            };
          }

          return { content: combined || "Command executed successfully", isError: false };
        } catch (error) {
          return {
            content: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
        }
      }

      case "search_files": {
        if (!input.pattern || typeof input.pattern !== "string") {
          return {
            content: "Pattern is required and must be a string",
            isError: true,
          };
        }
        const searchPath = input.path || ".";

        const process = new Deno.Command("grep", {
          args: ["-r", "-n", input.pattern, searchPath as string],
          cwd: BASE_DIR,
          stdout: "piped",
          stderr: "piped",
        });

        const { stdout, stderr } = await process.output();
        let output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        // Limit output to prevent context explosion
        const lines = output.split('\n');

        if (lines.length > SEARCH_RESULT_LIMIT) {
          output = lines.slice(0, SEARCH_RESULT_LIMIT).join('\n') +
            `\n\n... [${lines.length - SEARCH_RESULT_LIMIT} more matches truncated]`;
        } else if (output.length > SEARCH_CONTENT_LIMIT) {
          output = output.slice(0, SEARCH_CONTENT_LIMIT) +
            `\n\n... [output truncated at ${SEARCH_CONTENT_LIMIT} characters]`;
        }

        return {
          content: output || errorOutput || "No matches found",
          isError: false,
        };
      }

      case "reload_server": {
        try {
          // Touch main.ts to trigger Deno's watch mode reload
          const mainPath = join(BASE_DIR, "server", "main.ts");
          const stat = await Deno.stat(mainPath);

          // Update the file's access and modification times to trigger reload
          const now = new Date();
          await Deno.utime(mainPath, now, now);

          return {
            content: "Server reload triggered. The server will restart in watch mode and apply all code changes. This may take a few seconds.",
            isError: false,
          };
        } catch (error) {
          return {
            content: `Failed to trigger reload: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          };
        }
      }

      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}
