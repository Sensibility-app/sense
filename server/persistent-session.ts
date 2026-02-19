import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";
import { log, error } from "./logger.ts";
import { PATHS } from "./config.ts";
import type { Turn, Block } from "../shared/messages.ts";

export interface SessionData {
  id: string;
  created: string;
  lastActive: string;
  turns: Turn[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
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
  private tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private createdTime?: string;

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });

      if (await exists(PATHS.CURRENT_SESSION)) {
        const data = await Deno.readTextFile(PATHS.CURRENT_SESSION);
        const sessionData: SessionData = JSON.parse(data);
        this.turns = sessionData.turns || [];
        this.tokenUsage = sessionData.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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
        tokenUsage: this.tokenUsage,
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

  updateLastTurn(updater: (turn: Turn) => Turn): void {
    if (this.turns.length > 0) {
      this.turns[this.turns.length - 1] = updater(this.turns[this.turns.length - 1]);
      this.queueSave();
    }
  }

  private queueSave(): void {
    this.saveQueue = this.saveQueue
      .then(() => this.save())
      .catch((err) => error("Failed to save session:", err));
  }

  getTurns(): Turn[] {
    return this.turns;
  }

  getClaudeMessages(): Array<{ role: "user" | "assistant"; content: string | Block[] }> {
    return this.turns.map(t => ({ role: t.role, content: t.content }));
  }

  getSessionId(): string {
    return this.sessionId;
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
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    this.createdTime = new Date().toISOString();
    await this.save();
  }

  needsResume(): boolean {
    if (this.turns.length === 0) return false;
    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn.role === "user") return true;
    if (lastTurn.role === "assistant" && Array.isArray(lastTurn.content)) {
      const hasToolResult = lastTurn.content.some(b => b.type === "tool_result");
      if (hasToolResult) return true;
    }
    return false;
  }

  addTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): void {
    this.tokenUsage.inputTokens += usage.inputTokens;
    this.tokenUsage.outputTokens += usage.outputTokens;
    this.tokenUsage.totalTokens += usage.totalTokens;
    this.queueSave();
  }

  getTokenUsage() {
    return { ...this.tokenUsage };
  }

  async delete(): Promise<void> {
    try {
      if (await exists(PATHS.CURRENT_SESSION)) {
        await Deno.remove(PATHS.CURRENT_SESSION);
        log(`Deleted session`);
      }
    } catch (err) {
      error(`Failed to delete session:`, err);
    }
  }

  async shutdown(): Promise<void> {
    await this.save();
  }

  async compact(summary: string, keepRecentCount = 10): Promise<{ compactedCount: number; keptCount: number }> {
    if (this.turns.length <= keepRecentCount) {
      return { compactedCount: 0, keptCount: this.turns.length };
    }

    const compactedCount = this.turns.length - keepRecentCount;
    const recentTurns = this.turns.slice(-keepRecentCount);

    const summaryTurn = createTurn("user", `[Session compacted: ${compactedCount} turns summarized]\n\n${summary}`, "system");
    this.turns = [summaryTurn, ...recentTurns];
    await this.save();

    log(`Compacted: ${compactedCount} turns -> summary, kept ${keepRecentCount} recent`);
    return { compactedCount, keptCount: keepRecentCount };
  }

  getTurnsForCompaction(keepRecentCount = 10): { toCompact: Turn[]; toKeep: Turn[] } {
    if (this.turns.length <= keepRecentCount) {
      return { toCompact: [], toKeep: this.turns };
    }
    return {
      toCompact: this.turns.slice(0, -keepRecentCount),
      toKeep: this.turns.slice(-keepRecentCount)
    };
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
