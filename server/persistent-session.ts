import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";
import { log, error } from "./logger.ts";

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
        await this.updateLastActive();
        log(`Loaded current session with ${this.messages.length} messages`);

        // If task status is "running", server restarted mid-task
        if (this.currentTask?.status === "running") {
          log(`⚠️  Server restarted during task: "${this.currentTask.task}"`);
          this.currentTask.status = "interrupted";
          this.currentTask.interruptionReason = "server_restart";
          this.currentTask.canResume = true;
          await this.save();
        }

        if (this.currentTask?.status === "interrupted") {
          log(`⚠️  Session has interrupted task: "${this.currentTask.task}" (reason: ${this.currentTask.interruptionReason})`);
        }
        return true;
      }

      // New session
      await this.save();
      log(`Created new current session`);
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
        created: this.messages.length === 0 ? new Date().toISOString() : (await this.getCreatedTime()),
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

  private async getCreatedTime(): Promise<string> {
    try {
      if (await exists(CURRENT_SESSION_PATH)) {
        const data = await Deno.readTextFile(CURRENT_SESSION_PATH);
        const sessionData: SessionData = JSON.parse(data);
        return sessionData.created;
      }
    } catch {
      // Ignore
    }
    return new Date().toISOString();
  }

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
    // Save immediately to persist
    this.save().catch(error);
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
    await this.save();
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
    this.save().catch(error);
  }

  completeTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "completed";
      this.save().catch(error);
    }
  }

  failTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "failed";
      this.save().catch(error);
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
      this.save().catch(error);
    }
  }

  getInterruptedTask(): string | null {
    if (this.currentTask?.status === "running" || this.currentTask?.status === "interrupted") {
      return this.currentTask.task;
    }
    return null;
  }

  getCurrentTask() {
    return this.currentTask;
  }

  clearCurrentTask(): void {
    this.currentTask = undefined;
    this.save().catch(error);
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
