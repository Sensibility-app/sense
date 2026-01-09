/**
 * execute_command tool - Execute shell commands
 *
 * Executes whitelisted shell commands in the project root directory.
 * Only approved commands can be executed for security.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { parseCommand } from "../tools/_shared/command-whitelist.ts";
import { getBaseDir, sanitizeErrorMessage } from "../tools/_shared/sanitize.ts";
import { wrapCommandWithSandbox } from "../tools/_shared/sandbox.ts";
import { COMMAND_OUTPUT_LIMIT_CHARS, COMMAND_TIMEOUT_MS } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: true,
};

export const definition: ToolDefinition = {
  name: "execute_command",
  description: "Execute a whitelisted shell command in a sandboxed project environment. Commands run in a chroot-like jail where /server refers to the project's server directory, not the system root. Sandboxed with proot/bwrap if available. Timeout: 30 seconds.",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute (e.g., 'ls /server', 'rm -rf /client/dist', 'git status'). Absolute paths like /server refer to project directories when sandboxed."
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  // Validate command
  if (!input.command || typeof input.command !== "string") {
    return {
      content: "Command is required and must be a string",
      isError: true,
    };
  }

  try {
    // Parse and validate command against whitelist (blocks dangerous patterns)
    const { command, args } = parseCommand(input.command);

    // Wrap command with sandboxing (proot/bwrap if available)
    const { command: sandboxedCommand, args: sandboxedArgs, sandboxed } =
      await wrapCommandWithSandbox(command, args);

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), COMMAND_TIMEOUT_MS);

    try {
      // Execute command with timeout
      const process = new Deno.Command(sandboxedCommand, {
        args: sandboxedArgs,
        cwd: sandboxed ? undefined : getBaseDir(), // Sandbox handles cwd
        stdout: "piped",
        stderr: "piped",
        signal: abortController.signal,
      });

      const { code, stdout, stderr } = await process.output();
      clearTimeout(timeoutId);

      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);
      let combined = output + errorOutput;

      // Limit command output to prevent context explosion
      if (combined.length > COMMAND_OUTPUT_LIMIT_CHARS) {
        combined = combined.slice(0, COMMAND_OUTPUT_LIMIT_CHARS) +
          `\n\n... [output truncated at ${COMMAND_OUTPUT_LIMIT_CHARS} characters, total: ${combined.length} chars]`;
      }

      // Check exit code
      if (code !== 0) {
        return {
          content: `Command exited with code ${code}:\n${combined}`,
          isError: true,
        };
      }

      return { content: combined || "Command executed successfully", isError: false };
    } catch (error) {
      clearTimeout(timeoutId);

      // Check if it was a timeout
      if (error instanceof Error && error.name === "AbortError") {
        return {
          content: `Command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`,
          isError: true,
        };
      }

      throw error;
    }
  } catch (error) {
    return {
      content: `Command execution failed: ${sanitizeErrorMessage(error)}`,
      isError: true,
    };
  }
};
