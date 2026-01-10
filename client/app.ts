/**
 * Sense Client Application
 *
 * Entry point for the client application. Orchestrates initialization and
 * wiring of modular components:
 * - Renderer: UI rendering and DOM manipulation
 * - ConnectionManager: WebSocket lifecycle management
 * - MessageHandler: Message routing and business logic
 */

import { Renderer } from "./renderer.ts";
import { ConnectionManager } from "./connection.ts";
import { MessageHandler } from "./message-handler.ts";

// =============================================================================
// INITIALIZATION
// =============================================================================

// Query DOM elements
const output = document.getElementById("output")!;
const statusElement = document.getElementById("status")!;
const tokenInfo = document.getElementById("tokenInfo")!;
const taskInput = document.getElementById("taskInput") as HTMLTextAreaElement;
const submitBtn = document.getElementById("submitBtn")!;
const stopBtn = document.getElementById("stopBtn")!;

// =============================================================================
// MODULE INSTANTIATION
// =============================================================================

// Create renderer instance
const renderer = new Renderer(
  output,
  statusElement,
  tokenInfo,
  taskInput,
  submitBtn,
  stopBtn
);

// Create message handler instance (before connection, as connection needs it)
const messageHandler = new MessageHandler(renderer, null as any, taskInput);

// Create connection manager instance
const connection = new ConnectionManager(
  (message) => messageHandler.handleMessage(message),
  (status) => {
    renderer.updateConnectionStatus(status);
    // Set processing to false when disconnected
    if (status === "disconnected" || status === "error" || status === "failed") {
      renderer.setProcessing(false);
    }
  }
);

// Set connection in message handler (circular dependency resolution)
(messageHandler as any).connection = connection;

// =============================================================================
// EVENT LISTENERS
// =============================================================================

// Auto-resize textarea
taskInput.addEventListener("input", () => {
  taskInput.style.height = "40px";
  taskInput.style.height = Math.min(taskInput.scrollHeight, 200) + "px";
});

// Submit on Enter (Shift+Enter for newline)
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    messageHandler.submitTask();
  }
});

// Task submission handlers
submitBtn.addEventListener("click", () => messageHandler.submitTask());
stopBtn.addEventListener("click", () => messageHandler.stopTask());

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  connection.disconnect();
});

// =============================================================================
// LAYOUT FIXES
// =============================================================================

// Calculate and apply padding dynamically for fixed header/footer
function updateMainPadding() {
  const header = document.querySelector('header') as HTMLElement;
  const inputArea = document.querySelector('.input-area') as HTMLElement;
  const main = document.querySelector('main') as HTMLElement;

  if (header && inputArea && main) {
    const headerHeight = header.offsetHeight;
    const inputHeight = inputArea.offsetHeight;

    main.style.paddingTop = `${headerHeight}px`;
    main.style.paddingBottom = `${inputHeight}px`;
  }
}

// Mobile keyboard handling - adjust height when keyboard appears
taskInput.addEventListener('focus', () => {
  setTimeout(() => updateMainPadding(), 100);
});

taskInput.addEventListener('blur', () => {
  setTimeout(() => updateMainPadding(), 100);
});

// =============================================================================
// STARTUP
// =============================================================================

// Update padding on load and resize
window.addEventListener('load', updateMainPadding);
window.addEventListener('resize', updateMainPadding);

// Initial padding update
updateMainPadding();

// Auto-connect on page load
connection.connect();
