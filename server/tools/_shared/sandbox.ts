/**
 * Command sandboxing using userspace chroot alternatives
 *
 * Provides filesystem isolation for execute_command tool using:
 * - proot: User-space chroot (no root needed)
 * - bwrap (bubblewrap): Linux user namespaces
 *
 * With sandboxing, /server in commands refers to project's server directory,
 * not the system's /server directory.
 */

import { getBaseDir } from "./sanitize.ts";

type SandboxTool = "proot" | "bwrap" | null;

let cachedSandboxTool: SandboxTool | undefined = undefined;

/**
 * Detect available sandboxing tool
 * Checks for proot or bwrap availability
 *
 * @returns The available sandbox tool or null if none found
 */
async function detectSandboxTool(): Promise<SandboxTool> {
  if (cachedSandboxTool !== undefined) {
    return cachedSandboxTool;
  }

  const tools: SandboxTool[] = ["proot", "bwrap"];

  for (const tool of tools) {
    if (tool === null) continue;

    try {
      const check = new Deno.Command("which", { args: [tool], stdout: "null", stderr: "null" });
      const result = await check.output();

      if (result.code === 0) {
        cachedSandboxTool = tool;
        return tool;
      }
    } catch {
      // Tool not found, continue
    }
  }

  cachedSandboxTool = null;
  return null;
}

/**
 * Wrap command with sandboxing if available
 *
 * @param command - Command to execute (e.g., "rm")
 * @param args - Command arguments (e.g., ["-rf", "/server"])
 * @returns Wrapped command and args for sandboxed execution
 */
export async function wrapCommandWithSandbox(
  command: string,
  args: string[]
): Promise<{ command: string; args: string[]; sandboxed: boolean }> {
  const sandboxTool = await detectSandboxTool();
  const projectRoot = getBaseDir();

  if (sandboxTool === "proot") {
    // proot -r <root> -w / <command> <args...>
    // -r: Set root directory
    // -w: Set working directory inside jail
    return {
      command: "proot",
      args: [
        "-r", projectRoot,  // Root at project directory
        "-w", "/",          // Working directory is jail root
        command,
        ...args
      ],
      sandboxed: true,
    };
  } else if (sandboxTool === "bwrap") {
    // bwrap provides namespace isolation but not true chroot
    // Working directory is project root, commands run relative to it
    // Note: Absolute paths won't work as expected with bwrap (use proot for that)
    return {
      command: "bwrap",
      args: [
        // Bind project root to writable location
        "--bind", projectRoot, projectRoot,
        "--chdir", projectRoot,
        // Bind system directories (read-only) so commands can execute
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        // Essential system directories
        "--dev-bind", "/dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        // Restrict network (block most network access)
        "--unshare-net",
        // Execute command
        command,
        ...args
      ],
      sandboxed: true,
    };
  }

  // No sandbox available - validate that paths are safe
  // Block absolute paths since they would refer to system root
  for (const arg of args) {
    if (arg.startsWith('/')) {
      throw new Error(
        `Sandboxing not available. Absolute paths are blocked for security. ` +
        `Install 'proot' or 'bwrap' for proper sandboxing, or use relative paths. ` +
        `Found: '${arg}'`
      );
    }
    if (arg.includes('../')) {
      throw new Error(
        `Path traversal (..) is not allowed without sandboxing. Found: '${arg}'`
      );
    }
  }

  return {
    command,
    args,
    sandboxed: false,
  };
}

/**
 * Get information about available sandboxing
 *
 * @returns Object with sandbox status and tool name
 */
export async function getSandboxInfo(): Promise<{ available: boolean; tool: SandboxTool }> {
  const tool = await detectSandboxTool();
  return {
    available: tool !== null,
    tool,
  };
}
