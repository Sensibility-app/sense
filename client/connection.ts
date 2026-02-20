import type { ServerMessage } from "../shared/messages.ts";

const RECONNECT_DELAY = 2000;
const PING_INTERVAL = 30000;

export class Connection {
  private ws: WebSocket | null = null;
  private statusEl: HTMLElement;
  private pingTimer: number | null = null;

  public onMessage: (message: ServerMessage) => void = () => {};

  constructor(statusEl: HTMLElement) {
    this.statusEl = statusEl;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const base = window.location.pathname.replace(/\/$/, "");
    this.ws = new WebSocket(`${protocol}//${window.location.host}${base}/ws`);

    this.ws.onopen = () => {
      this.statusEl.className = "status connected";
      this.startPing();
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== "pong") {
          this.onMessage(msg);
        }
      } catch {}
    };

    this.ws.onclose = () => {
      this.stopPing();
      this.statusEl.className = "status reconnecting";
      setTimeout(() => this.connect(), RECONNECT_DELAY);
    };

    this.ws.onerror = () => {
      this.statusEl.className = "status error";
    };
  }

  disconnect(): void {
    this.ws?.close();
  }

  send(type: string, content?: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(content ? { type, content } : { type }));
    return true;
  }

  sendCommand(name: string, args: Record<string, string>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "command", name, args }));
    return true;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
