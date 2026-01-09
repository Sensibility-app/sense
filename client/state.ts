/**
 * Client state management
 *
 * Centralizes all global state and configuration constants
 */

export interface AppState {
  ws: WebSocket | null;
  isProcessing: boolean;
  currentAssistantMessage: HTMLDivElement | null;
  currentAssistantText: string;
  currentToolUse: HTMLDivElement | null;
  isFirstConnection: boolean;
  connectionState: "connected" | "disconnected" | "reconnecting";
  heartbeatInterval: number | null;
  reconnectAttempts: number;
}

export const state: AppState = {
  ws: null,
  isProcessing: false,
  currentAssistantMessage: null,
  currentAssistantText: "",
  currentToolUse: null,
  isFirstConnection: true,
  connectionState: "disconnected",
  heartbeatInterval: null,
  reconnectAttempts: 0,
};

export const CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 10,
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 5000,
  RECONNECT_BASE_DELAY: 2000,
  RECONNECT_EXPONENTIAL_BASE: 1.5,
  RECONNECT_MAX_DELAY: 30000,
};
