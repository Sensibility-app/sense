import type { ServerMessage } from "../shared/messages.ts";

const RECONNECT_DELAY = 2000;

export class Connection {
  private eventSource: EventSource | null = null;
  private statusEl: HTMLElement;
  private base: string;

  public onMessage: (message: ServerMessage) => void = () => {};

  constructor(statusEl: HTMLElement) {
    this.statusEl = statusEl;
    this.base = window.location.pathname.replace(/\/$/, "");
  }

  connect(): void {
    if (this.eventSource) return;

    this.eventSource = new EventSource(`${this.base}/events`);

    this.eventSource.onopen = () => {
      this.statusEl.className = "status connected";
    };

    this.eventSource.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data) as ServerMessage);
      } catch { /* malformed event */ }
    };

    this.eventSource.onerror = () => {
      this.statusEl.className = "status reconnecting";
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        setTimeout(() => this.connect(), RECONNECT_DELAY);
      }
    };
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  async sendTask(content: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/task`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendCommand(name: string, args: Record<string, string>): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, args }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async stopTask(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/stop`, { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async clearSession(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/clear`, { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
