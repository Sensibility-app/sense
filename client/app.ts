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

// Task submission handlers with haptic feedback
submitBtn.addEventListener("click", () => {
  hapticFeedback('medium');
  messageHandler.submitTask();
});
stopBtn.addEventListener("click", () => {
  hapticFeedback('heavy');
  messageHandler.stopTask();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  connection.disconnect();
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Haptic feedback helper for mobile devices
function hapticFeedback(style: 'light' | 'medium' | 'heavy' = 'light') {
  if ('vibrate' in navigator) {
    const patterns = {
      light: 10,
      medium: 20,
      heavy: 30
    };
    navigator.vibrate(patterns[style]);
  }
}

// =============================================================================
// LAYOUT FIXES - Visual Viewport Height Management
// =============================================================================

let lastH = -1;
let lastTop = -1;

function resetVVCache() {
  lastH = -1;
  lastTop = -1;
}

// Sync visual viewport to handle iOS keyboard and panning behavior
function syncVisualViewport(force = false) {
  const vv = window.visualViewport;
  if (!vv) return;

  // Round to reduce sub-pixel churn during keyboard animation
  const h = Math.round(vv.height);
  const top = Math.round(vv.offsetTop);

  // Only write when actually changed (prevents late "extra" jump writes)
  // Or force write when explicitly requested
  if (force || h !== lastH) {
    document.documentElement.style.setProperty('--app-height', `${h}px`);
    lastH = h;
  }

  if (force || top !== lastTop) {
    document.documentElement.style.setProperty('--vv-top', `${top}px`);
    lastTop = top;
  }
}

// Reset cache on focus/blur to ensure updates during keyboard transitions
taskInput.addEventListener('focus', () => {
  resetVVCache();
  let n = 0;
  const pump = () => {
    syncVisualViewport(true);
    if (++n < 6) requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
});
taskInput.addEventListener('blur', () => {
  resetVVCache();
  syncVisualViewport(true);
});

window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport); // IMPORTANT on iOS
window.addEventListener('resize', syncVisualViewport);

syncVisualViewport();

// =============================================================================
// TOUCH SCROLL LOCK - Prevent page scrolling except in #output
// =============================================================================

// Prevent touch scrolling everywhere except inside the #output container
// This stops iOS from turning the whole page into a scrollable surface when keyboard is up
document.addEventListener(
  'touchmove',
  (e) => {
    // Allow scrolling only inside the output container
    if (!e.target || !(e.target as HTMLElement).closest('#output')) {
      e.preventDefault();
    }
  },
  { passive: false }
);

// =============================================================================
// SCROLL DETECTION
// =============================================================================

// Detect scroll position for gradient overlay
output.addEventListener('scroll', () => {
  if (output.scrollTop > 10) {
    output.classList.add('scrolled');
  } else {
    output.classList.remove('scrolled');
  }
});

// =============================================================================
// STARTUP
// =============================================================================

// Auto-connect on page load
connection.connect();
