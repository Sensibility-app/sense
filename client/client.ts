import { state, CONFIG } from "./state.ts";
import { setupConnection, connect, sendMessage as sendWsMessage, isConnected, disconnect } from "./connection.ts";
import {
  setupUI,
  scrollToBottom,
  addUserMessage,
  addAssistantMessage,
  startAssistantMessage,
  appendToAssistantMessage,
  finishAssistantMessage,
  addSystemMessage,
  addThinkingBlock,
  addToolUse,
  addToolResult,
  addToolFromHistory,
  setProcessing,
  updateTokenInfo,
  updateTokenInfoFromContext,
  clearOutput
} from "./ui-renderer.ts";

// DOM elements
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const tokenInfo = document.getElementById("tokenInfo");
const taskInput = document.getElementById("taskInput");
const submitBtn = document.getElementById("submitBtn");
const stopBtn = document.getElementById("stopBtn");

// Handle all incoming messages from server
function handleMessage(message) {
  switch (message.type) {
    case "session_info":
      handleSessionInfo(message);
      break;

    case "connection_status":
      // Server-side connection status updates (handled by connection module)
      // Connection module automatically updates status based on WebSocket state
      break;

    case "processing_status":
      setProcessing(message.isProcessing);
      break;

    case "token_usage":
      updateTokenInfo(message.formatted);
      break;

    case "user_message":
      addUserMessage(message.content);
      break;

    case "assistant_response":
      startAssistantMessage();
      if (message.content) {
        appendToAssistantMessage(message.content);
      }
      break;

    case "text_delta":
      appendToAssistantMessage(message.content);
      break;

    case "thinking":
      addThinkingBlock(message.content);
      break;

    case "tool_use":
      addToolUse(message.toolName, message.toolId, message.toolInput);
      break;

    case "tool_result":
      addToolResult(message.toolId, message.content, message.isError);
      break;

    case "system":
      addSystemMessage(message.content, message.level);
      break;

    case "task_complete":
      finishAssistantMessage();
      scrollToBottom();
      break;

    default:
      console.log("Unknown message type:", message.type);
  }
}

// Handle session info (includes history)
function handleSessionInfo(message) {
  // Update token info if available
  updateTokenInfoFromContext(message.contextSize);

  // Clear output and display history
  clearOutput();

  if (message.history && message.history.length > 0) {
    // Render history
    message.history.forEach(entry => {
      if (entry.type === "user") {
        addUserMessage(entry.content);
      } else if (entry.type === "assistant") {
        addAssistantMessage(entry.content);
      } else if (entry.type === "system") {
        addSystemMessage(entry.content, "info");
      } else if (entry.type === "tool") {
        addToolFromHistory(entry);
      } else if (entry.type === "thinking") {
        addThinkingBlock(entry.content);
      }
    });
  }
  
  // All system messages now come from server - client just displays them

  scrollToBottom();
  state.isFirstConnection = false;
}


// Send message with connection validation
function sendMessage(type, content = "") {
  const success = sendWsMessage(type, content);

  if (!success) {
    // Show user feedback for failed task submissions
    if (type === "task" && content) {
      addSystemMessage("Cannot send message - not connected to server", "error");
    }
  }

  return success;
}

// Submit task with connection validation
function submitTask() {
  const task = taskInput.value.trim();
  if (!task || isProcessing) return;

  // Check connection state before sending
  if (connectionState !== "connected") {
    addSystemMessage("Cannot send task - not connected to server", "error");
    return;
  }

  // Check for slash commands
  if (task === "/clear") {
    if (sendMessage("clear_session")) {
      taskInput.value = "";
      taskInput.style.height = "20px";
    }
    return;
  }

  // Send task message
  if (sendMessage("task", task)) {
    taskInput.value = "";
    taskInput.style.height = "20px"; // Reset height
  }
}

// Stop task
function stopTask() {
  sendMessage("stop_task");
}

// Auto-resize textarea
taskInput.addEventListener("input", () => {
  taskInput.style.height = "20px";
  taskInput.style.height = Math.min(taskInput.scrollHeight, 200) + "px";
});

// Submit on Enter (Shift+Enter for newline)
taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitTask();
  }
});

// Button handlers
submitBtn.addEventListener("click", submitTask);
stopBtn.addEventListener("click", stopTask);
// Button handlers
submitBtn.addEventListener("click", submitTask);
stopBtn.addEventListener("click", stopTask);

// Mobile-specific connection handling
function setupMobileConnectionHandling() {
  // Handle page visibility changes (app backgrounding/foregrounding)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('App became visible');
      // Check connection when app comes back to foreground
      if (connectionState !== "connected" && ws?.readyState !== WebSocket.OPEN) {
        console.log('Reconnecting after app became visible');
        connect();
      }
    } else {
      console.log('App became hidden');
    }
  });

  // Handle network status changes
  window.addEventListener('online', () => {
    console.log('Network came online');
    if (connectionState !== "connected") {
      console.log('Reconnecting after network came online');
      connect();
    }
  });

  window.addEventListener('offline', () => {
    console.log('Network went offline');
    // Connection module will handle disconnection
    disconnect();
  });

  // Handle focus/blur for additional connection checking
  window.addEventListener('focus', () => {
    console.log('Window gained focus');
    // Small delay to let network settle
    setTimeout(() => {
      if (connectionState !== "connected" && navigator.onLine) {
        console.log('Checking connection after window focus');
        connect();
      }
    }, 100);
  });

  // Handle beforeunload to close connection cleanly
  window.addEventListener('beforeunload', () => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.close(1000, 'Page unloading');
    }
  });
}

// Initialize mobile optimizations
setupMobileKeyboardHandling();
setupMobileTouchHandling();
setupMobileConnectionHandling();

// Setup UI renderer with DOM elements
setupUI(output, submitBtn, stopBtn, taskInput, tokenInfo);

// Setup connection module with required dependencies
setupConnection(handleMessage, setProcessing, statusEl);

// Connect on load
connect();