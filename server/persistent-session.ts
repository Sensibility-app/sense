import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";
import { log, error } from "./logger.ts";
import { SESSION_SAVE_DEBOUNCE_MS } from "./constants.ts";

const SENSE_DIR = join(Deno.cwd(), ".sense");
const CURRENT_SESSION_PATH = join(SENSE_DIR, "current-session.json");

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: unknown;
}

export interface SessionData {
  id: string;
  created: string;
  lastActive: string;
  messages: ConversationMessage[];
  currentTask?: {
    task: string;
    startedAt: string;
    status: "running" | "completed" | "failed" | "interrupted";
    interruptionReason?: "max_iterations" | "user_stopped" | "loop_detected" | "server_restart" | "error";
    iterationCount?: number;
    canResume?: boolean;
  };
}

export class PersistentSession {
  private sessionId: string;
  private messages: ConversationMessage[] = [];
  private currentTask?: {
    task: string;
    startedAt: string;
    status: "running" | "completed" | "failed" | "interrupted";
    interruptionReason?: "max_iterations" | "user_stopped" | "loop_detected" | "server_restart" | "error";
    iterationCount?: number;
    canResume?: boolean;
  };
  private saveTimeout?: number;
  private pendingSave = false;
  private createdTime?: string;

  constructor() {
    this.sessionId = "current";
  }

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(SENSE_DIR, { recursive: true });

      if (await exists(CURRENT_SESSION_PATH)) {
        const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
        const sessionData: SessionData = JSON.parse(data);
        this.messages = sessionData.messages;
        this.currentTask = sessionData.currentTask;
        this.sessionId = sessionData.id;
        this.createdTime = sessionData.created; // Cache created time
        await this.updateLastActive();
        log(`Loaded current session with ${this.messages.length} messages`);

        // If task status is "running", server restarted mid-task
        if (this.currentTask?.status === "running") {
          log(`⚠️  Server restarted during task: "${this.currentTask.task}"`);
          this.currentTask.status = "interrupted";
          this.currentTask.interruptionReason = "server_restart";
          this.currentTask.canResume = true;
          await this.flushSave(); // Immediate save for critical state
        }

        if (this.currentTask?.status === "interrupted") {
          log(`⚠️  Session has interrupted task: "${this.currentTask.task}" (reason: ${this.currentTask.interruptionReason})`);
        }
        return true;
      }

      // New session
      this.createdTime = new Date().toISOString();
      await this.flushSave(); // Immediate save for new session
      log(`Created new current session`);
      return false;
    } catch (err) {
      error(`Failed to load session:`, err);
      return false;
    }
  }

  // Debounced save - batches writes within SESSION_SAVE_DEBOUNCE_MS window
  save(): void {
    // Mark that we have a pending save
    this.pendingSave = true;

    // Clear existing timeout
    if (this.saveTimeout !== undefined) {
      clearTimeout(this.saveTimeout);
    }

    // Schedule save
    this.saveTimeout = setTimeout(() => {
      this.flushSave().catch((err) => error("Failed to flush save:", err));
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  // Immediate save - flushes pending saves immediately
  async flushSave(): Promise<void> {
    // Clear any pending debounced save
    if (this.saveTimeout !== undefined) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = undefined;
    }

    if (!this.pendingSave && this.messages.length > 0) {
      // No pending changes, skip
      return;
    }

    this.pendingSave = false;

    try {
      const sessionData: SessionData = {
        id: this.sessionId,
        created: this.createdTime || new Date().toISOString(),
        lastActive: new Date().toISOString(),
        messages: this.messages,
        ...(this.currentTask && { currentTask: this.currentTask }),
      };

      await Deno.mkdir(SENSE_DIR, { recursive: true });
      await Deno.writeTextFile(CURRENT_SESSION_PATH, JSON.stringify(sessionData, null, 2));
    } catch (err) {
      error(`Failed to save session:`, err);
    }
  }

  // No longer needed - createdTime is cached in memory
  // private async getCreatedTime(): Promise<string> removed

  private async updateLastActive(): Promise<void> {
    try {
      if (await exists(CURRENT_SESSION_PATH)) {
        const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
        const sessionData: SessionData = JSON.parse(data);
        sessionData.lastActive = new Date().toISOString();
        await Deno.writeTextFile(CURRENT_SESSION_PATH, JSON.stringify(sessionData, null, 2));
      }
    } catch {
      // Ignore
    }
  }

  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
    // Debounced save - batches rapid message additions
    this.save();
  }

  // Batch add multiple messages (useful for history loading)
  batchAddMessages(messages: ConversationMessage[]): void {
    this.messages.push(...messages);
    this.save();
  }

  getMessages(): ConversationMessage[] {
    return this.messages;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  private estimateTokenCount(content: unknown): number {
    const str = JSON.stringify(content);
    return Math.ceil(str.length / 4);
  }

  // Get total estimated token count for session
  getSessionTokenCount(): number {
    return this.messages.reduce((total, msg) => {
      return total + this.estimateTokenCount(msg.content);
    }, 0);
  }

  // Get session size info
  getSessionSizeInfo(): { messageCount: number; estimatedTokens: number; bytes: number } {
    const bytes = JSON.stringify(this.messages).length;
    const estimatedTokens = this.getSessionTokenCount();
    return {
      messageCount: this.messages.length,
      estimatedTokens,
      bytes,
    };
  }

  async clear(): Promise<void> {
    this.messages = [];
    this.currentTask = undefined; // Clear interrupted task as well
    this.createdTime = new Date().toISOString(); // Reset created time
    await this.flushSave(); // Immediate save for clear operation
  }

  async delete(): Promise<void> {
    try {
      if (await exists(CURRENT_SESSION_PATH)) {
        await Deno.remove(CURRENT_SESSION_PATH);
        log(`Deleted current session`);
      }
    } catch (err) {
      error(`Failed to delete session:`, err);
    }
  }

  // Task state management
  startTask(task: string): void {
    this.currentTask = {
      task,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    this.save(); // Debounced save
  }

  completeTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "completed";
      this.save(); // Debounced save
    }
  }

  failTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "failed";
      this.save(); // Debounced save
    }
  }

  interruptTask(
    reason: "max_iterations" | "user_stopped" | "loop_detected" | "server_restart" | "error",
    iterationCount?: number,
    canResume: boolean = true
  ): void {
    if (this.currentTask) {
      this.currentTask.status = "interrupted";
      this.currentTask.interruptionReason = reason;
      this.currentTask.iterationCount = iterationCount;
      this.currentTask.canResume = canResume;
      this.save(); // Debounced save
    }
  }

  getCurrentTask() {
    return this.currentTask;
  }

  clearCurrentTask(): void {
    this.currentTask = undefined;
    this.save(); // Debounced save
  }

  // Cleanup method to ensure final save before shutdown
  async shutdown(): Promise<void> {
    await this.flushSave();
  }
}

// Archive current session (create timestamped backup)
export async function archiveCurrentSession(): Promise<void> {
  try {
    if (await exists(CURRENT_SESSION_PATH)) {
      const archiveDir = join(SENSE_DIR, "archives");
      await Deno.mkdir(archiveDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
      const archivePath = join(archiveDir, `session_${timestamp}.json`);

      const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
      await Deno.writeTextFile(archivePath, data);

      log(`Archived current session to ${archivePath}`);
    }
  } catch (err) {
    error("Failed to archive session:", err);
  }
}
