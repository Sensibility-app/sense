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
  compaction?: {
    cursor: number;   // turns[0..cursor-1] are summarized — LLM only sees summary + turns[cursor..]
    summary: string;  // cumulative summary of all compacted turns
  };
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
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
  private compaction?: { cursor: number; summary: string };
  private saveQueue: Promise<void> = Promise.resolve();
  private tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  private createdTime?: string;

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(PATHS.SESSIONS_DIR, { recursive: true });

      if (await exists(PATHS.CURRENT_SESSION)) {
        const data = await Deno.readTextFile(PATHS.CURRENT_SESSION);
        const sessionData: SessionData = JSON.parse(data);
        this.turns = sessionData.turns || [];
        this.compaction = sessionData.compaction;
        this.tokenUsage = sessionData.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
        this.tokenUsage.cacheCreationInputTokens ??= 0;
        this.tokenUsage.cacheReadInputTokens ??= 0;
        this.sessionId = sessionData.id;
        this.createdTime = sessionData.created;
        log(`Session loaded: ${this.turns.length} turns${this.compaction ? ` (compacted at ${this.compaction.cursor})` : ""}`);
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
        compaction: this.compaction,
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

  private queueSave(): void {
    this.saveQueue = this.saveQueue
      .then(() => this.save())
      .catch((err) => error("Failed to save session:", err));
  }

  /** Full history — for the UI. Never truncated by compaction. */
  getTurns(): Turn[] {
    return this.turns;
  }

  /** Compacted view — for the LLM. Returns [summary, ...recent] when compacted. */
  getLLMMessages(): Array<{ role: "user" | "assistant"; content: string | Block[] }> {
    if (!this.compaction) {
      return this.turns.map(t => ({ role: t.role, content: t.content }));
    }

    const { cursor, summary } = this.compaction;
    const summaryMsg: { role: "user" | "assistant"; content: string } = {
      role: "user",
      content: `[Session compacted: ${cursor} turns summarized]\n\n${summary}`,
    };

    // Skip orphaned tool_result turns at the cursor boundary
    // (their corresponding tool_use is behind the cursor, i.e. summarized away)
    let start = cursor;
    while (start < this.turns.length) {
      const turn = this.turns[start];
      if (
        turn.role === "user" &&
        Array.isArray(turn.content) &&
        (turn.content as Block[]).every(b => b.type === "tool_result")
      ) {
        start++;
      } else {
        break;
      }
    }

    const recent = this.turns.slice(start).map(t => ({ role: t.role, content: t.content }));

    // LLM API requires user/assistant alternation.
    // Summary is "user", so if the next turn is also "user" we need a bridge.
    if (recent.length > 0 && recent[0].role !== "assistant") {
      return [summaryMsg, { role: "assistant" as const, content: "Understood. Continuing from compacted context." }, ...recent];
    }

    return [summaryMsg, ...recent];
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
    this.compaction = undefined;
    this.tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    this.createdTime = new Date().toISOString();
    this.queueSave();
    await this.saveQueue;
  }

  needsResume(): boolean {
    if (this.turns.length === 0) return false;
    const lastTurn = this.turns[this.turns.length - 1];
    if (lastTurn.role === "user") return true;
    if (lastTurn.role === "assistant" && Array.isArray(lastTurn.content)) {
      const hasToolUse = lastTurn.content.some(b => b.type === "tool_use");
      if (hasToolUse) return true;
    }
    return false;
  }

  addTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number }): void {
    this.tokenUsage.inputTokens += usage.inputTokens;
    this.tokenUsage.outputTokens += usage.outputTokens;
    this.tokenUsage.totalTokens += usage.totalTokens;
    this.tokenUsage.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    this.tokenUsage.cacheReadInputTokens += usage.cacheReadInputTokens;
    this.queueSave();
  }

  getTokenUsage() {
    return { ...this.tokenUsage };
  }

  async shutdown(): Promise<void> {
    this.queueSave();
    await this.saveQueue;
  }

  /**
   * Non-destructive compaction. Moves the cursor forward — turns are never deleted.
   * UI still sees full history via getTurns(). LLM sees [summary, ...recent] via getLLMMessages().
   */
  async compact(summary: string, keepRecentCount = 10): Promise<{ compactedCount: number; keptCount: number }> {
    const totalTurns = this.turns.length;
    if (totalTurns <= keepRecentCount) {
      return { compactedCount: 0, keptCount: totalTurns };
    }

    const newCursor = totalTurns - keepRecentCount;
    const previousCursor = this.compaction?.cursor ?? 0;
    const newlyCompacted = newCursor - previousCursor;

    this.compaction = { cursor: newCursor, summary };
    this.queueSave();
    await this.saveQueue;

    log(`Compacted: cursor ${previousCursor} -> ${newCursor} (${newlyCompacted} new turns summarized, ${keepRecentCount} kept)`);
    return { compactedCount: newlyCompacted, keptCount: keepRecentCount };
  }

  getTurnsForCompaction(keepRecentCount = 10): { toCompact: Turn[]; toKeep: Turn[] } {
    if (this.turns.length <= keepRecentCount) {
      return { toCompact: [], toKeep: this.turns };
    }
    return {
      toCompact: this.turns.slice(0, -keepRecentCount),
      toKeep: this.turns.slice(-keepRecentCount),
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
