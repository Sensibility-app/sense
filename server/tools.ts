import { Action } from "./protocol.ts";
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

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Execute a single action
export async function executeAction(action: Action): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "fs.readFile": {
        const path = sanitizePath(action.path);
        const content = await Deno.readTextFile(path);
        return { success: true, data: content };
      }

      case "fs.writeFile": {
        const path = sanitizePath(action.path);
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, action.content);
        return { success: true, data: `Wrote ${action.path}` };
      }

      case "fs.listDir": {
        const path = sanitizePath(action.path);
        const entries: string[] = [];
        for await (const entry of Deno.readDir(path)) {
          entries.push(entry.name);
        }
        return { success: true, data: entries };
      }

      case "fs.move": {
        const from = sanitizePath(action.from);
        const to = sanitizePath(action.to);
        await Deno.mkdir(dirname(to), { recursive: true });
        await Deno.rename(from, to);
        return { success: true, data: `Moved ${action.from} to ${action.to}` };
      }

      case "fs.delete": {
        const path = sanitizePath(action.path);
        await Deno.remove(path, { recursive: true });
        return { success: true, data: `Deleted ${action.path}` };
      }

      case "proc.exec": {
        const cmd = action.cmd.split(" ");
        const process = new Deno.Command(cmd[0], {
          args: cmd.slice(1),
          cwd: BASE_DIR,
          stdout: "piped",
          stderr: "piped",
        });

        const { code, stdout, stderr } = await process.output();
        const output = new TextDecoder().decode(stdout);
        const errorOutput = new TextDecoder().decode(stderr);

        if (code !== 0) {
          return {
            success: false,
            error: `Command failed (exit ${code}):\n${errorOutput}`,
          };
        }

        return { success: true, data: output + errorOutput };
      }

      case "git.status": {
        const process = new Deno.Command("git", {
          args: ["status", "--short"],
          cwd: BASE_DIR,
          stdout: "piped",
          stderr: "piped",
        });

        const { stdout, stderr } = await process.output();
        const output = new TextDecoder().decode(stdout);
        const error = new TextDecoder().decode(stderr);

        return { success: true, data: output || error };
      }

      case "git.diff": {
        const process = new Deno.Command("git", {
          args: ["diff"],
          cwd: BASE_DIR,
          stdout: "piped",
          stderr: "piped",
        });

        const { stdout, stderr } = await process.output();
        const output = new TextDecoder().decode(stdout);
        const error = new TextDecoder().decode(stderr);

        return { success: true, data: output || error };
      }

      default:
        return { success: false, error: "Unknown action type" };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
