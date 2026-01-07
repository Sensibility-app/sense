import { join, dirname } from "jsr:@std/path@^1.0.0";

const BASE_DIR = Deno.cwd();

// Ensure path is safe and within project
function sanitizePath(path: string): string {
  const resolved = join(BASE_DIR, path);
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

// MCP-style tool definitions for Claude
export const TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file contents as a string.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to project root",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories as needed.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to project root",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in a given path. Returns an array of entry names.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the directory relative to project root (use '.' for root)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_command",
    description: "Execute a shell command in the project directory. Returns stdout/stderr. Use this for running tests, builds, git commands, etc.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to execute (e.g., 'deno test', 'git status')",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for a pattern in files using grep. Returns matching lines with file paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Pattern to search for",
        },
        path: {
          type: "string",
          description: "Path to search in (default: '.')",
        },
      },
      required: ["pattern"],
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
        const content = await Deno.readTextFile(path);
        return { content, isError: false };
      }

      case "write_file": {
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
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, input.content);
        return { content: `Successfully wrote ${input.path}`, isError: false };
      }

      case "list_directory": {
        const pathInput = input.path || ".";
        if (typeof pathInput !== "string") {
          return {
            content: `Path must be a string, received "${typeof pathInput}". Use "." for current directory.`,
            isError: true,
          };
        }
        const path = sanitizePath(pathInput);
        const entries: string[] = [];
        for await (const entry of Deno.readDir(path)) {
          entries.push(entry.name);
        }
        return { content: entries.join("\n"), isError: false };
      }

      case "execute_command": {
        if (!input.command || typeof input.command !== "string") {
          return {
            content: "Command is required and must be a string",
            isError: true,
          };
        }
        const cmd = input.command.split(" ");
        const process = new Deno.Command(cmd[0], {
          args: cmd.slice(1),
          cwd: BASE_DIR,
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await process.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);
        const combined = output + errorOutput;

        if (code !== 0) {
          return {
            content: `Command exited with code ${code}:\n${combined}`,
            isError: true,
          };
        }

        return { content: combined || "Command executed successfully", isError: false };
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
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        return {
          content: output || errorOutput || "No matches found",
          isError: false,
        };
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
