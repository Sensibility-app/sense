import { PATHS } from "./config.ts";

await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });
await Deno.writeTextFile(PATHS.LOG_FILE, `=== Server started at ${new Date().toISOString()} ===\n`);

function writeLog(level: string, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");

  const logLine = `[${timestamp}]${level ? ` ${level}:` : ''} ${message}\n`;
  (level === "ERROR" ? console.error : console.log)(...args);
  Deno.writeTextFile(PATHS.LOG_FILE, logLine, { append: true }).catch(() => {});
}

export const log = (...args: unknown[]) => writeLog("", args);
export const error = (...args: unknown[]) => writeLog("ERROR", args);
