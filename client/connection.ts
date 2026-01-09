/**
 * WebSocket connection management
 *
 * Handles WebSocket lifecycle, reconnection, and heartbeat
 */

import { state, CONFIG } from "./state.ts";

// Callbacks and DOM elements set by client
let messageHandler: (message: any) => void;
let processingHandler: (isProcessing: boolean) => void;
let statusElement: HTMLElement;

/**
 * Initialize connection module with required dependencies
 */
export function setupConnection(
  onMessage: (message: any) => void,
  onProcessingChange: (isProcessing: boolean) => void,
  statusEl: HTMLElement
) {
  console.log("[setupConnection] statusEl:", statusEl);
  messageHandler = onMessage;
  processingHandler = onProcessingChange;
  statusElement = statusEl;
  console.log("[setupConnection] statusElement set to:", statusElement);
}

/**
 * Connect to WebSocket server
 */
export function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
    console.log("[WebSocket] onopen fired");
    state.connectionState = "connected";
    state.reconnectAttempts = 0;
    console.log("[WebSocket] About to call updateConnectionStatus");
    updateConnectionStatus("connected");
    startHeartbeat();
  };

  state.ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Handle heartbeat pong
      if (message.type === "pong") {
        console.log("Received pong from server");
        return;
      }

      messageHandler(message);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  };

  state.ws.onclose = (event) => {
    console.log("WebSocket closed", event.code, event.reason);
    state.connectionState = "disconnected";
    updateConnectionStatus("disconnected");
    stopHeartbeat();
    processingHandler(false);

    // Exponential backoff for reconnection
    const delay = Math.min(
      CONFIG.RECONNECT_BASE_DELAY * Math.pow(CONFIG.RECONNECT_EXPONENTIAL_BASE, state.reconnectAttempts),
      CONFIG.RECONNECT_MAX_DELAY
    );
    state.reconnectAttempts++;

    if (state.reconnectAttempts <= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.log(`Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(connect, delay);
    } else {
      console.log("Max reconnection attempts reached");
      updateConnectionStatus("failed");
    }
  };

  state.ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    state.connectionState = "error";
    updateConnectionStatus("error");
  };
}

/**
 * Update connection status in header
 */
function updateConnectionStatus(status: string) {
  console.log("[updateConnectionStatus] called with status:", status, "statusElement:", statusElement);
  if (!statusElement) {
    console.error("[updateConnectionStatus] statusElement is null or undefined!");
    return;
  }

  switch (status) {
    case "connected":
      statusElement.textContent = "Connected";
      statusElement.classList.add("connected");
      statusElement.classList.remove("error", "reconnecting");
      break;
    case "disconnected":
      statusElement.textContent = state.reconnectAttempts > 0 ? "Reconnecting..." : "Disconnected";
      statusElement.classList.remove("connected");
      statusElement.classList.add("reconnecting");
      break;
    case "error":
      statusElement.textContent = "Connection Error";
      statusElement.classList.remove("connected", "reconnecting");
      statusElement.classList.add("error");
      break;
    case "failed":
      statusElement.textContent = "Connection Failed";
      statusElement.classList.remove("connected", "reconnecting");
      statusElement.classList.add("error");
      break;
  }
}

/**
 * Start heartbeat to detect broken connections
 */
function startHeartbeat() {
  stopHeartbeat(); // Clear any existing interval
  state.heartbeatInterval = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      console.log("Sending ping to server");
      try {
        state.ws.send(JSON.stringify({ type: "ping" }));

        // Set a timeout to detect if server doesn't respond
        setTimeout(() => {
          if (state.connectionState === "connected") {
            console.log("Heartbeat timeout - connection may be broken");
            // Force reconnection
            state.ws!.close();
          }
        }, CONFIG.HEARTBEAT_TIMEOUT);
      } catch (error) {
        console.error("Error sending ping:", error);
        state.connectionState = "disconnected";
        updateConnectionStatus("disconnected");
        state.ws!.close();
      }
    }
  }, CONFIG.HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }
}

/**
 * Test connection by sending a ping
 */
export function testConnection(): boolean {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    state.ws.send(JSON.stringify({ type: "ping" }));
    return true;
  } catch (error) {
    console.error("Connection test failed:", error);
    state.connectionState = "disconnected";
    updateConnectionStatus("disconnected");
    return false;
  }
}

/**
 * Check if WebSocket is connected
 */
export function isConnected(): boolean {
  return state.ws !== null &&
         state.ws.readyState === WebSocket.OPEN &&
         state.connectionState === "connected";
}

/**
 * Send message to server
 */
export function sendMessage(type: string, content: string = ""): boolean {
  if (!isConnected()) {
    console.log("Cannot send message - connection not ready", {
      wsExists: !!state.ws,
      readyState: state.ws?.readyState,
      connectionState: state.connectionState
    });

    // Try to reconnect if not already trying
    if (state.connectionState !== "connected" && state.reconnectAttempts === 0) {
      connect();
    }

    return false;
  }

  try {
    const message = content ? { type, content } : { type };
    state.ws.send(JSON.stringify(message));
    console.log("Message sent:", type);
    return true;
  } catch (error) {
    console.error("Error sending message:", error);
    return false;
  }
}

/**
 * Close connection cleanly
 */
export function disconnect() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close(1000, 'Client disconnect');
  }
  stopHeartbeat();
}
