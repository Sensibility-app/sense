/**
 * execute_command tool - Execute shell commands
 *
 * Executes whitelisted shell commands in the project root directory.
 * Only approved commands can be executed for security.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";
import { parseCommand } from "../tools/_shared/command-whitelist.ts";
import { getBaseDir } from "../tools/_shared/sanitize.ts";
import { COMMAND_OUTPUT_LIMIT_CHARS } from "../constants.ts";

export const permissions: ToolPermissions = {
  filesystem: ["read"],
  network: false,
  execute: true,
};

export const definition: ToolDefinition = {
  name: "execute_command",
  description: "Execute a whitelisted shell command in the project root directory. Only approved commands can be executed for security (git, deno, npm, node, ls, cat, grep, find, echo, pwd, which, whoami, curl, wget, jq, python, python3, ruby, go, cargo, rustc).",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute (e.g., 'git status', 'deno test', 'npm install'). Command must be in the whitelist."
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
    // Parse and validate command against whitelist
    const { command, args } = parseCommand(input.command);

    // Execute command
    const process = new Deno.Command(command, {
      args: args,
      cwd: getBaseDir(),
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

    // Check exit code
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
};
