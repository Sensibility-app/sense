import { join } from "jsr:@std/path@^1.0.0";

const SENSE_DIR = join(Deno.cwd(), ".sense");
const LOG_FILE = join(SENSE_DIR, "server.log");

// Ensure log directory exists
await Deno.mkdir(SENSE_DIR, { recursive: true });

// Create or clear log file on startup
await Deno.writeTextFile(LOG_FILE, `=== Server started at ${new Date().toISOString()} ===\n`);

export function log(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");

  const logLine = `[${timestamp}] ${message}\n`;

  // Write to console
  console.log(...args);

  // Write to file (async, non-blocking)
  Deno.writeTextFile(LOG_FILE, logLine, { append: true }).catch(() => {
    // Ignore file write errors
  });
}

export function error(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");

  const logLine = `[${timestamp}] ERROR: ${message}\n`;

  // Write to console
  console.error(...args);

  // Write to file (async, non-blocking)
  Deno.writeTextFile(LOG_FILE, logLine, { append: true }).catch(() => {
    // Ignore file write errors
  });
}

export function getLogPath(): string {
  return LOG_FILE;
}
