import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";

const SESSIONS_DIR = join(Deno.cwd(), ".sense", "active-sessions");

export interface ConversationMessage {
  role: "user" | "assistant";
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
    status: "running" | "completed" | "failed";
  };
}

export class PersistentSession {
  private sessionId: string;
  private sessionPath: string;
  private messages: ConversationMessage[] = [];
  private currentTask?: {
    task: string;
    startedAt: string;
    status: "running" | "completed" | "failed";
  };

  constructor(sessionId?: string) {
    this.sessionId = sessionId || this.generateSessionId();
    this.sessionPath = join(SESSIONS_DIR, `${this.sessionId}.json`);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async load(): Promise<boolean> {
    try {
      await Deno.mkdir(SESSIONS_DIR, { recursive: true });

      if (await exists(this.sessionPath)) {
        const data = await Deno.readTextFile(this.sessionPath);
        const sessionData: SessionData = JSON.parse(data);
        this.messages = sessionData.messages;
        this.currentTask = sessionData.currentTask;
        await this.updateLastActive();
        console.log(`Loaded session ${this.sessionId} with ${this.messages.length} messages`);
        if (this.currentTask?.status === "running") {
          console.log(`⚠️  Session has interrupted task: "${this.currentTask.task}"`);
        }
        return true;
      }

      // New session
      await this.save();
      console.log(`Created new session ${this.sessionId}`);
      return false;
    } catch (error) {
      console.error(`Failed to load session ${this.sessionId}:`, error);
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

      await Deno.mkdir(SESSIONS_DIR, { recursive: true });
      await Deno.writeTextFile(this.sessionPath, JSON.stringify(sessionData, null, 2));
    } catch (error) {
      console.error(`Failed to save session ${this.sessionId}:`, error);
    }
  }

  private async getCreatedTime(): Promise<string> {
    try {
      if (await exists(this.sessionPath)) {
        const data = await Deno.readTextFile(this.sessionPath);
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
      if (await exists(this.sessionPath)) {
        const data = await Deno.readTextFile(this.sessionPath);
        const sessionData: SessionData = JSON.parse(data);
        sessionData.lastActive = new Date().toISOString();
        await Deno.writeTextFile(this.sessionPath, JSON.stringify(sessionData, null, 2));
      }
    } catch {
      // Ignore
    }
  }

  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
    // Save immediately to persist
    this.save().catch(console.error);
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

  async clear(): Promise<void> {
    this.messages = [];
    await this.save();
  }

  async delete(): Promise<void> {
    try {
      if (await exists(this.sessionPath)) {
        await Deno.remove(this.sessionPath);
        console.log(`Deleted session ${this.sessionId}`);
      }
    } catch (error) {
      console.error(`Failed to delete session ${this.sessionId}:`, error);
    }
  }

  // Task state management
  startTask(task: string): void {
    this.currentTask = {
      task,
      startedAt: new Date().toISOString(),
      status: "running",
    };
    this.save().catch(console.error);
  }

  completeTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "completed";
      this.save().catch(console.error);
    }
  }

  failTask(): void {
    if (this.currentTask) {
      this.currentTask.status = "failed";
      this.save().catch(console.error);
    }
  }

  getInterruptedTask(): string | null {
    if (this.currentTask?.status === "running") {
      return this.currentTask.task;
    }
    return null;
  }

  clearCurrentTask(): void {
    this.currentTask = undefined;
    this.save().catch(console.error);
  }
}

// Cleanup old sessions (optional, can be called periodically)
export async function cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    await Deno.mkdir(SESSIONS_DIR, { recursive: true });

    for await (const entry of Deno.readDir(SESSIONS_DIR)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        const filePath = join(SESSIONS_DIR, entry.name);
        const data = await Deno.readTextFile(filePath);
        const sessionData: SessionData = JSON.parse(data);

        const lastActive = new Date(sessionData.lastActive).getTime();
        const now = Date.now();

        if (now - lastActive > maxAgeMs) {
          await Deno.remove(filePath);
          console.log(`Cleaned up old session: ${entry.name}`);
        }
      }
    }
  } catch (error) {
    console.error("Failed to cleanup old sessions:", error);
  }
}
