import { join } from "jsr:@std/path@^1.0.0";

interface SessionEntry {
  timestamp: string;
  task: string;
  response: unknown;
  duration?: number;
  success: boolean;
  error?: string;
}

export class SessionLogger {
  private sessionFile: string;
  private entries: SessionEntry[] = [];

  constructor() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").replace("Z", "");
    this.sessionFile = join(Deno.cwd(), ".sense", "sessions", `session_${timestamp}.json`);
  }

  async logTask(task: string, response: unknown, success: boolean, startTime?: number, error?: string): Promise<void> {
    const entry: SessionEntry = {
      timestamp: new Date().toISOString(),
      task,
      response,
      success,
      ...(startTime && { duration: Date.now() - startTime }),
      ...(error && { error }),
    };

    this.entries.push(entry);
    await this.saveSession();
  }

  private async saveSession(): Promise<void> {
    try {
      const sessionData = {
        sessionStart: this.entries[0]?.timestamp || new Date().toISOString(),
        totalEntries: this.entries.length,
        entries: this.entries,
      };

      const dir = join(Deno.cwd(), ".sense", "sessions");
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeTextFile(this.sessionFile, JSON.stringify(sessionData, null, 2));
    } catch (error) {
      console.error("Failed to save session log:", error);
    }
  }

  getSessionFile(): string {
    return this.sessionFile;
  }

  getEntryCount(): number {
    return this.entries.length;
  }
}
