import { join } from "jsr:@std/path@^1.0.0";

const SENSE_DIR = join(Deno.cwd(), ".sense");
const LOG_FILE = join(SENSE_DIR, "server.log");

// Ensure log directory exists
await Deno.mkdir(SENSE_DIR, { recursive: true });

// Create or clear log file on startup
await Deno.writeTextFile(LOG_FILE, `=== Server started at ${new Date().toISOString()} ===\n`);

/**
 * Common logging helper - formats message and writes to file
 */
function _writeLog(prefix: string, consoleMethod: (...args: unknown[]) => void, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");

  const logLine = `[${timestamp}]${prefix ? ` ${prefix}:` : ''} ${message}\n`;

  // Write to console
  consoleMethod(...args);

  // Write to file (async, non-blocking, ignore errors)
  Deno.writeTextFile(LOG_FILE, logLine, { append: true }).catch(() => {});
}

export function log(...args: unknown[]): void {
  _writeLog("", console.log, args);
}

export function error(...args: unknown[]): void {
  _writeLog("ERROR", console.error, args);
}

export function logDebug(...args: unknown[]): void {
  // Only log debug messages in development mode
  if (Deno.env.get("DENO_ENV") !== "production") {
    _writeLog("DEBUG", console.log, args);
  }
}

export function getLogPath(): string {
  return LOG_FILE;
}
