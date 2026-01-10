/**
 * WebSocket Connection Management Module
 *
 * Encapsulates WebSocket lifecycle, heartbeat mechanism, and reconnection logic.
 * Uses dependency injection for message and status callbacks.
 */

import { state, CONFIG } from "./state.ts";

// =============================================================================
// TYPES
// =============================================================================

export type MessageCallback = (message: any) => void;
export type StatusCallback = (status: string) => void;

// =============================================================================
// CONNECTION MANAGER CLASS
// =============================================================================

export class ConnectionManager {
  private connecting: boolean = false; // Prevent duplicate connection attempts

  constructor(
    private onMessage: MessageCallback,
    private onStatusChange: StatusCallback
  ) {}

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.connecting) {
      console.log("Connection already in progress, skipping duplicate attempt");
      return;
    }

    this.connecting = true;

    // Clean up any existing WebSocket
    if (state.connection.ws) {
      try {
        const oldState = state.connection.ws.readyState;
        if (oldState === WebSocket.CONNECTING || oldState === WebSocket.OPEN) {
          state.connection.ws.close();
        }
        state.connection.ws = null;
      } catch (e) {
        console.log("Error cleaning up old WebSocket:", e);
      }
    }

    // Set connecting status if this is the first connection
    if (state.connection.isFirstConnection) {
      state.connection.status = "connecting";
      this.onStatusChange("connecting");
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      state.connection.ws = new WebSocket(wsUrl);

      state.connection.ws.onopen = () => this.handleOpen();
      state.connection.ws.onmessage = (event) => this.handleMessage(event);
      state.connection.ws.onclose = (event) => this.handleClose(event);
      state.connection.ws.onerror = (error) => this.handleError(error);
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      this.connecting = false;
      this.onStatusChange("error");
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (state.connection.ws && state.connection.ws.readyState === WebSocket.OPEN) {
      state.connection.ws.close(1000, "Client disconnect");
    }
    this.stopHeartbeat();
  }

  /**
   * Send message to server
   */
  send(type: string, content: string = ""): boolean {
    if (!this.isConnected()) {
      console.log("Cannot send message - connection not ready", {
        wsExists: !!state.connection.ws,
        readyState: state.connection.ws?.readyState,
        connectionState: state.connection.status,
      });

      // Try to reconnect if not already trying
      if (
        state.connection.status !== "connected" &&
        state.connection.reconnectAttempts === 0
      ) {
        this.connect();
      }

      return false;
    }

    try {
      const message = content ? { type, content } : { type };
      state.connection.ws!.send(JSON.stringify(message));
      console.log("Message sent:", type);
      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  }

  /**
   * Check if WebSocket is connected and ready
   */
  isConnected(): boolean {
    return (
      state.connection.ws !== null &&
      state.connection.ws.readyState === WebSocket.OPEN &&
      state.connection.status === "connected"
    );
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  private handleOpen(): void {
    console.log("WebSocket opened successfully");
    this.connecting = false;
    state.connection.status = "connected";
    state.connection.reconnectAttempts = 0;
    this.onStatusChange("connected");
    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);

      // Handle heartbeat pong
      if (message.type === "pong") {
        console.log("Received pong from server");
        // Clear the timeout - connection is alive
        if (state.connection.pendingHeartbeatTimeout !== null) {
          clearTimeout(state.connection.pendingHeartbeatTimeout);
          state.connection.pendingHeartbeatTimeout = null;
        }
        return;
      }

      // Delegate to message handler
      this.onMessage(message);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  }

  private handleClose(event: CloseEvent): void {
    console.log("WebSocket closed", event.code, event.reason);
    this.connecting = false;
    state.connection.status = "disconnected";
    this.onStatusChange("disconnected");
    this.stopHeartbeat();

    // Automatic reconnection with exponential backoff
    const delay = Math.min(
      CONFIG.RECONNECT_BASE_DELAY *
        Math.pow(
          CONFIG.RECONNECT_EXPONENTIAL_BASE,
          state.connection.reconnectAttempts
        ),
      CONFIG.RECONNECT_MAX_DELAY
    );
    state.connection.reconnectAttempts++;

    if (state.connection.reconnectAttempts <= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.log(
        `Reconnecting in ${delay}ms (attempt ${state.connection.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`
      );
      setTimeout(() => this.connect(), delay);
    } else {
      console.log("Max reconnection attempts reached");
      this.onStatusChange("failed");
    }
  }

  private handleError(error: Event): void {
    console.error("WebSocket error:", error);
    this.connecting = false;
    state.connection.status = "disconnected";
    this.onStatusChange("error");
  }

  // ===========================================================================
  // HEARTBEAT MECHANISM
  // ===========================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat(); // Clear any existing interval
    state.connection.heartbeatInterval = setInterval(() => {
      if (
        state.connection.ws &&
        state.connection.ws.readyState === WebSocket.OPEN
      ) {
        console.log("Sending ping to server");
        try {
          state.connection.ws.send(JSON.stringify({ type: "ping" }));

          // Set a timeout to detect if server doesn't respond
          // If pong is received, this timeout will be cleared in handleMessage
          state.connection.pendingHeartbeatTimeout = setTimeout(() => {
            console.log(
              "Heartbeat timeout - no pong received, closing connection"
            );
            state.connection.pendingHeartbeatTimeout = null;
            // No pong received - connection is dead, force reconnection
            if (state.connection.ws) {
              state.connection.ws.close();
            }
          }, CONFIG.HEARTBEAT_TIMEOUT);
        } catch (error) {
          console.error("Error sending ping:", error);
          state.connection.status = "disconnected";
          this.onStatusChange("disconnected");
          state.connection.ws!.close();
        }
      }
    }, CONFIG.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (state.connection.heartbeatInterval) {
      clearInterval(state.connection.heartbeatInterval);
      state.connection.heartbeatInterval = null;
    }
    // Also clear any pending timeout
    if (state.connection.pendingHeartbeatTimeout !== null) {
      clearTimeout(state.connection.pendingHeartbeatTimeout);
      state.connection.pendingHeartbeatTimeout = null;
    }
  }
}
