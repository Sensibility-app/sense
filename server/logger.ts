import { PATHS } from "./config.ts";

await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });
await Deno.writeTextFile(PATHS.LOG_FILE, `=== Server started at ${new Date().toISOString()} ===\n`);

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? "\n" + arg.stack : ""}`;
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}
function writeLog(level: string, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(formatArg).join(" ");

  const logLine = `[${timestamp}]${level ? ` ${level}:` : ""} ${message}\n`;
  (level === "ERROR" ? console.error : console.log)(...args);
  Deno.writeTextFile(PATHS.LOG_FILE, logLine, { append: true }).catch(() => {});
}

export const log = (...args: unknown[]) => writeLog("", args);
export const error = (...args: unknown[]) => writeLog("ERROR", args);
