/**
 * Centralized State Management
 *
 * Single source of truth for all application state.
 * No dependencies - pure state container.
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ConnectionState {
  ws: WebSocket | null;
  status: "connected" | "disconnected" | "reconnecting" | "connecting";
  reconnectAttempts: number;
  heartbeatInterval: number | null;
  pendingHeartbeatTimeout: number | null; // Moved from closure variable
  isFirstConnection: boolean;
}

export interface RenderState {
  currentAssistantMessage: HTMLDivElement | null;
  currentAssistantText: string;
}

export interface AppState {
  connection: ConnectionState;
  render: RenderState;
  isProcessing: boolean;
}

// =============================================================================
// STATE OBJECT
// =============================================================================

export const state: AppState = {
  connection: {
    ws: null,
    status: "connecting",
    reconnectAttempts: 0,
    heartbeatInterval: null,
    pendingHeartbeatTimeout: null,
    isFirstConnection: true,
  },
  render: {
    currentAssistantMessage: null,
    currentAssistantText: "",
  },
  isProcessing: false,
};

// =============================================================================
// CONFIGURATION
// =============================================================================

export const CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 10,
  HEARTBEAT_INTERVAL: 30000,
  HEARTBEAT_TIMEOUT: 5000,
  RECONNECT_BASE_DELAY: 2000,
  RECONNECT_EXPONENTIAL_BASE: 1.5,
  RECONNECT_MAX_DELAY: 30000,
};

// =============================================================================
// STATE QUERY HELPERS
// =============================================================================

/**
 * Check if WebSocket is connected and ready
 */
export function isConnected(): boolean {
  return (
    state.connection.ws !== null &&
    state.connection.ws.readyState === WebSocket.OPEN &&
    state.connection.status === "connected"
  );
}

/**
 * Check if currently processing a task
 */
export function isProcessing(): boolean {
  return state.isProcessing;
}

/**
 * Get current connection status
 */
export function getConnectionStatus(): string {
  return state.connection.status;
}
