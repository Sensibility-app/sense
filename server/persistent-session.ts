import { join } from "@std/path";
import { exists } from "@std/fs";
import { error, log } from "./logger.ts";
import { PATHS } from "./config.ts";
import type { Block, Turn } from "../shared/messages.ts";

export interface SessionData {
  id: string;
  created: string;
  lastActive: string;
  turns: Turn[];
  costMicrocents: number;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function createTurn(role: "user" | "assistant", content: string | Block[], taskId: string): Turn {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    taskId,
    role,
    content,
  };
}

export class PersistentSession {
  private sessionId = "current";
  private turns: Turn[] = [];
  private saveQueue: Promise<void> = Promise.resolve();
  private costMicrocents = 0;
  private createdTime?: string;

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });

      if (await exists(PATHS.CURRENT_SESSION)) {
        const data = await Deno.readTextFile(PATHS.CURRENT_SESSION);
        const sessionData: SessionData = JSON.parse(data);
        this.turns = sessionData.turns;
        this.costMicrocents = sessionData.costMicrocents ?? 0;
        this.sessionId = sessionData.id;
        this.createdTime = sessionData.created;
        log(`Session loaded: ${this.turns.length} turns`);
        return true;
      }

      this.createdTime = new Date().toISOString();
      await this.save();
      log(`Created new session`);
      return false;
    } catch (err) {
      error(`Failed to load session:`, err);
      return false;
    }
  }

  async save(): Promise<void> {
    try {
      const sessionData: SessionData = {
        id: this.sessionId,
        created: this.createdTime || new Date().toISOString(),
        lastActive: new Date().toISOString(),
        turns: this.turns,
        costMicrocents: this.costMicrocents,
      };

      await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });
      const tempPath = PATHS.CURRENT_SESSION + ".tmp";
      await Deno.writeTextFile(tempPath, JSON.stringify(sessionData, null, 2));
      await Deno.rename(tempPath, PATHS.CURRENT_SESSION);
    } catch (err) {
      error(`Failed to save session:`, err);
    }
  }

  addTurn(turn: Turn): void {
    this.turns.push(turn);
    this.queueSave();
  }

  getLastTurn(): Turn | undefined {
    return this.turns[this.turns.length - 1];
  }

  private queueSave(): void {
    this.saveQueue = this.saveQueue
      .then(() => this.save())
      .catch((err) => error("Failed to save session:", err));
  }

  getTurns(): Turn[] {
    return this.turns;
  }

  getLLMMessages(): Array<{ role: "user" | "assistant"; content: string | Block[] }> {
    return this.turns.map((t) => ({ role: t.role, content: t.content }));
  }

  getTurnCount(): number {
    return this.turns.length;
  }

  getSessionSizeInfo(): { turnCount: number; estimatedTokens: number; bytes: number } {
    const bytes = JSON.stringify(this.turns).length;
    const estimatedTokens = Math.ceil(bytes / 4);
    return { turnCount: this.turns.length, estimatedTokens, bytes };
  }

  async clear(): Promise<void> {
    this.turns = [];
    this.costMicrocents = 0;
    this.createdTime = new Date().toISOString();
    this.queueSave();
    await this.saveQueue;
  }

  needsResume(): boolean {
    if (this.turns.length === 0) return false;
    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn.role === "user") return true;
    if (lastTurn.role === "assistant" && Array.isArray(lastTurn.content)) {
      const hasToolUse = lastTurn.content.some((b) => b.type === "tool_use");
      if (hasToolUse) return true;
    }
    return false;
  }

  addCost(microcents: number): void {
    this.costMicrocents += microcents;
    this.queueSave();
  }

  getCostMicrocents(): number {
    return this.costMicrocents;
  }

  async shutdown(): Promise<void> {
    this.queueSave();
    await this.saveQueue;
  }
}

export async function archiveCurrentSession(): Promise<void> {
  try {
    if (await exists(PATHS.CURRENT_SESSION)) {
      const archiveDir = join(PATHS.SESSIONS_DIR, "archives");
      await Deno.mkdir(archiveDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const archivePath = join(archiveDir, `session_${timestamp}.json`);
      const data = await Deno.readTextFile(PATHS.CURRENT_SESSION);
      await Deno.writeTextFile(archivePath, data);
      log(`Archived session to ${archivePath}`);
    }
  } catch (err) {
    error("Failed to archive session:", err);
  }
}
