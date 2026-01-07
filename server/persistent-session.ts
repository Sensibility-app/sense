import { join } from "jsr:@std/path@^1.0.0";
import { exists } from "jsr:@std/fs@^1.0.0";

const SENSE_DIR = join(Deno.cwd(), ".sense");
const CURRENT_SESSION_PATH = join(SENSE_DIR, "current-session.json");

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
  private messages: ConversationMessage[] = [];
  private currentTask?: {
    task: string;
    startedAt: string;
    status: "running" | "completed" | "failed";
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
        console.log(`Loaded current session with ${this.messages.length} messages`);
        if (this.currentTask?.status === "running") {
          console.log(`⚠️  Session has interrupted task: "${this.currentTask.task}"`);
        }
        return true;
      }

      // New session
      await this.save();
      console.log(`Created new current session`);
      return false;
    } catch (error) {
      console.error(`Failed to load session:`, error);
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
    } catch (error) {
      console.error(`Failed to save session:`, error);
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
      if (await exists(CURRENT_SESSION_PATH)) {
        await Deno.remove(CURRENT_SESSION_PATH);
        console.log(`Deleted current session`);
      }
    } catch (error) {
      console.error(`Failed to delete session:`, error);
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

      console.log(`Archived current session to ${archivePath}`);
    }
  } catch (error) {
    console.error("Failed to archive session:", error);
  }
}
