/**
 * Command execution whitelist and parsing
 *
 * Security utilities for the execute_command tool. Only whitelisted
 * commands can be executed to prevent arbitrary code execution.
 */

// Allowed commands for execute_command tool (security whitelist)
export const ALLOWED_COMMANDS = new Set([
  "git", "deno", "npm", "node",
  "ls", "cat", "grep", "find",
  "echo", "pwd", "which", "whoami",
  "curl", "wget", "jq",
  "python", "python3", "ruby", "go", "cargo", "rustc"
]);

/**
 * Parse command string into command and arguments
 * Handles quoted strings and escaped characters properly
 *
 * @param commandString - Full command string (e.g., "git commit -m 'message'")
 * @returns Parsed command and arguments
 * @throws Error if command is empty or not whitelisted
 */
export function parseCommand(commandString: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < commandString.length; i++) {
    const char = commandString[i];
    const nextChar = commandString[i + 1];

    if ((char === '"' || char === "'") && !inQuotes) {
      // Start quoted string
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      // End quoted string
      inQuotes = false;
      quoteChar = "";
    } else if (char === " " && !inQuotes) {
      // Space outside quotes - new part
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

  // Add final part
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
    throw new Error(
      `Command '${command}' is not allowed. Allowed commands: ${Array.from(ALLOWED_COMMANDS).join(", ")}`
    );
  }

  return { command, args };
}
