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

// DOM elements (using unique names to avoid conflicts with ui-renderer.ts)
const outputEl = document.getElementById("output");
const statusEl = document.getElementById("status");
const tokenInfoEl = document.getElementById("tokenInfo");
const taskInputEl = document.getElementById("taskInput") as HTMLTextAreaElement;
const submitBtnEl = document.getElementById("submitBtn");
const stopBtnEl = document.getElementById("stopBtn");

console.log("[client.ts] DOM elements:", { outputEl, statusEl, tokenInfoEl, taskInputEl, submitBtnEl, stopBtnEl });

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
  const task = taskInputEl.value.trim();
  if (!task || state.isProcessing) return;

  // Check connection state before sending
  if (state.connectionState !== "connected") {
    addSystemMessage("Cannot send task - not connected to server", "error");
    return;
  }

  // Check for slash commands
  if (task === "/clear") {
    if (sendMessage("clear_session")) {
      taskInputEl.value = "";
      taskInputEl.style.height = "20px";
    }
    return;
  }

  // Send task message
  if (sendMessage("task", task)) {
    taskInputEl.value = "";
    taskInputEl.style.height = "20px"; // Reset height
  }
}

// Stop task
function stopTask() {
  sendMessage("stop_task");
}

// Auto-resize textarea
taskInputEl.addEventListener("input", () => {
  taskInputEl.style.height = "20px";
  taskInputEl.style.height = Math.min(taskInputEl.scrollHeight, 200) + "px";
});

// Submit on Enter (Shift+Enter for newline)
taskInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitTask();
  }
});

// Button handlers
submitBtnEl.addEventListener("click", submitTask);
stopBtnEl.addEventListener("click", stopTask);

// Handle beforeunload to close connection cleanly
window.addEventListener('beforeunload', () => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.close(1000, 'Page unloading');
  }
});

// Setup UI renderer with DOM elements
console.log("[client.ts] About to call setupUI");
setupUI(outputEl, submitBtnEl, stopBtnEl, taskInputEl, tokenInfoEl);

// Setup connection module with required dependencies
console.log("[client.ts] About to call setupConnection with statusEl:", statusEl);
setupConnection(handleMessage, setProcessing, statusEl);

// Connect on load
console.log("[client.ts] About to call connect()");
connect();