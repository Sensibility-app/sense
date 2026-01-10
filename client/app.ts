/**
 * Sense Client Application
 *
 * Consolidated client-side application managing state, UI rendering,
 * WebSocket connection, and message orchestration.
 */

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

export interface AppState {
  ws: WebSocket | null;
  isProcessing: boolean;
  currentAssistantMessage: HTMLDivElement | null;
  currentAssistantText: string;
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

// =============================================================================
// UI RENDERING
// =============================================================================

// DOM elements
let output: HTMLElement;
let submitBtn: HTMLElement;
let stopBtn: HTMLElement;
let taskInput: HTMLTextAreaElement;
let tokenInfo: HTMLElement;


/**
 * Scroll output to bottom
 */
function scrollToBottom() {
  if (output) {
    output.scrollTop = output.scrollHeight;
  }
}

/**
 * Parse markdown and render to HTML element with error handling
 */
function parseMarkdown(text: string, element: HTMLElement) {
  try {
    element.innerHTML = (window as any).marked.parse(text);
  } catch (e) {
    console.error("Markdown parse error:", e);
    element.textContent = text;
  }
}

/**
 * Make a content element collapsible by clicking on its header
 */
function makeCollapsible(
  header: HTMLElement,
  content: HTMLElement,
  arrowSelector: string,
  collapsedSymbol: string,
  expandedSymbol: string
) {
  header.onclick = () => {
    content.classList.toggle("collapsed");
    const arrow = header.querySelector(arrowSelector);
    arrow!.textContent = content.classList.contains("collapsed") ? collapsedSymbol : expandedSymbol;
  };
}

/**
 * Create message element (base renderer for all message types)
 */
function createMessage(
  type: "user" | "assistant" | "system",
  content: string,
  options: {
    level?: "info" | "error" | "success";
    parseMarkdown?: boolean;
  } = {}
): HTMLElement {
  const message = document.createElement("div");
  message.className = `message ${type}`;

  if (type === "system" && options.level === "error") {
    message.classList.add("error");
  }

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";

  if (options.parseMarkdown) {
    parseMarkdown(content, messageContent);
  } else {
    messageContent.textContent = content;
  }

  message.appendChild(messageContent);
  return message;
}

/**
 * Add message to output (unified function)
 */
function addMessage(
  type: "user" | "assistant" | "system",
  content: string,
  options = {}
): void {
  const message = createMessage(type, content, options);
  output.appendChild(message);
  scrollToBottom();
}

/**
 * Add user message to output
 */
function addUserMessage(content: string) {
  addMessage("user", content);
}

/**
 * Add assistant message to output (for history)
 */
function addAssistantMessage(content: string) {
  addMessage("assistant", content, { parseMarkdown: true });
}

/**
 * Start streaming assistant message
 */
function startAssistantMessage() {
  // Finish any existing message first
  finishAssistantMessage();

  state.currentAssistantMessage = document.createElement("div");
  state.currentAssistantMessage.className = "message assistant";
  state.currentAssistantText = "";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content streaming-cursor";
  messageContent.textContent = "";

  state.currentAssistantMessage.appendChild(messageContent);
  output.appendChild(state.currentAssistantMessage);
  scrollToBottom();
}

/**
 * Append text to streaming assistant message
 */
function appendToAssistantMessage(text: string) {
  if (!state.currentAssistantMessage) {
    startAssistantMessage();
  }

  state.currentAssistantText += text;
  const content = state.currentAssistantMessage!.querySelector(".message-content") as HTMLElement;

  // Try to render markdown in real-time (falls back to text if incomplete)
  parseMarkdown(state.currentAssistantText, content);

  scrollToBottom();
}

/**
 * Finish streaming assistant message
 */
function finishAssistantMessage() {
  if (state.currentAssistantMessage) {
    const content = state.currentAssistantMessage.querySelector(".message-content") as HTMLElement;
    content.classList.remove("streaming-cursor");

    // Final markdown parse
    if (state.currentAssistantText.trim()) {
      parseMarkdown(state.currentAssistantText, content);
    }

    state.currentAssistantMessage = null;
    state.currentAssistantText = "";
  }
}

/**
 * Add system message to output
 */
function addSystemMessage(content: string, level: string = "info") {
  addMessage("system", content, { level });
}

/**
 * Add thinking block to output
 */
function addThinkingBlock(content: string) {
  const block = document.createElement("div");
  block.className = "thinking-block";

  const header = document.createElement("div");
  header.className = "thinking-header";
  header.innerHTML = '<span>💭 Thinking</span><span>▼</span>';

  const thinkingContent = document.createElement("div");
  thinkingContent.className = "thinking-content collapsed";
  thinkingContent.textContent = content;

  makeCollapsible(header, thinkingContent, "span:last-child", "▶", "▼");

  block.appendChild(header);
  block.appendChild(thinkingContent);
  output.appendChild(block);
  scrollToBottom();
}

/**
 * Format tool input parameters for display
 */
function formatToolParams(toolInput: any): string {
  if (!toolInput || typeof toolInput !== "object") {
    return "";
  }

  const params = Object.entries(toolInput)
    .map(([key, value]) => {
      if (typeof value === "string") {
        const displayValue = value.length > 50 ? value.substring(0, 50) + "..." : value;
        return `${key}="${displayValue}"`;
      }
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(", ");

  return params ? `(${params})` : "";
}

/**
 * Add tool to output (unified function for both streaming and history)
 */
function addTool(toolName: string, toolInput: any, options: {
  toolId?: string,
  result?: string,
  isError?: boolean,
  fromHistory?: boolean
} = {}) {
  // Finish any streaming assistant message before showing tool
  if (!options.fromHistory) {
    finishAssistantMessage();
  }

  const toolBlock = document.createElement("div");
  toolBlock.className = "tool-use";

  if (options.toolId) {
    toolBlock.dataset.toolId = options.toolId;
  }

  const paramString = formatToolParams(toolInput);

  const header = document.createElement("div");
  header.className = "tool-header";
  header.innerHTML = `<span>›</span><span class="tool-name">${toolName}${paramString}</span>`;

  toolBlock.appendChild(header);

  // Add result if provided (for history or completed tools)
  if (options.result !== undefined) {
    const result = document.createElement("div");
    result.className = `tool-result collapsed ${options.isError ? "error" : ""}`;
    result.textContent = options.result;

    // Make it collapsible
    makeCollapsible(header, result, "span:first-child", "›", "⌄");

    toolBlock.appendChild(result);
  }

  output.appendChild(toolBlock);
  scrollToBottom();
}

/**
 * Add tool use to output
 */
function addToolUse(toolName: string, toolId: string, toolInput: any) {
  addTool(toolName, toolInput, { toolId });
}

/**
 * Add tool result to output
 */
function addToolResult(toolId: string, content: string, isError: boolean) {
  const toolBlock = document.querySelector(`[data-tool-id="${toolId}"]`) as HTMLElement;
  if (!toolBlock) {
    console.warn("Tool block not found for:", toolId);
    return;
  }

  const result = document.createElement("div");
  result.className = `tool-result collapsed ${isError ? "error" : ""}`;
  result.textContent = content;

  const header = toolBlock.querySelector(".tool-header") as HTMLElement;

  // Make it collapsible
  makeCollapsible(header, result, "span:first-child", "›", "⌄");

  toolBlock.appendChild(result);
  scrollToBottom();
}

/**
 * Add tool from history
 */
function addToolFromHistory(entry: any) {
  if (entry.toolName && entry.toolInput) {
    addTool(entry.toolName, entry.toolInput, {
      result: entry.toolResult,
      isError: entry.toolError,
      fromHistory: true
    });
  } else {
    // Fallback for old format - create a simple tool display
    addTool(entry.content || "unknown", {}, {
      fromHistory: true
    });
  }
}

/**
 * Set processing state and update UI
 */
function setProcessing(processing: boolean) {
  state.isProcessing = processing;

  // Don't allow processing if not connected
  if (processing && state.connectionState !== "connected") {
    state.isProcessing = false;
    processing = false;
  }

  if (processing) {
    submitBtn.style.display = "none";
    stopBtn.style.display = "flex";
    taskInput.disabled = true;
  } else {
    submitBtn.style.display = "flex";
    stopBtn.style.display = "none";
    taskInput.disabled = false;
    taskInput.focus();
  }
}

/**
 * Update token info display
 */
function updateTokenInfo(formatted: string) {
  if (formatted) {
    tokenInfo.textContent = formatted;
    tokenInfo.style.display = "block";
  }
}

/**
 * Update token info from context size
 */
function updateTokenInfoFromContext(contextSize: any) {
  if (contextSize) {
    if (contextSize.estimatedTokens > 0) {
      tokenInfo.textContent = `~${contextSize.estimatedTokens.toLocaleString()} tokens`;
      tokenInfo.style.display = "block";
    } else {
      // Hide token display when tokens are 0 (session cleared)
      tokenInfo.style.display = "none";
    }
  }
}

/**
 * Clear output
 */
function clearOutput() {
  output.innerHTML = "";
}

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

// Connection state
let statusElement: HTMLElement;
let pendingHeartbeatTimeout: number | null = null;

/**
 * Connect to WebSocket server
 */
function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
    state.connectionState = "connected";
    state.reconnectAttempts = 0;
    updateConnectionStatus("connected");
    startHeartbeat();
  };

  state.ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Handle heartbeat pong
      if (message.type === "pong") {
        console.log("Received pong from server");
        // Clear the timeout - connection is alive
        if (pendingHeartbeatTimeout !== null) {
          clearTimeout(pendingHeartbeatTimeout);
          pendingHeartbeatTimeout = null;
        }
        return;
      }

      handleMessage(message);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  };

  state.ws.onclose = (event) => {
    console.log("WebSocket closed", event.code, event.reason);
    state.connectionState = "disconnected";
    updateConnectionStatus("disconnected");
    stopHeartbeat();
    setProcessing(false);

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
    state.connectionState = "disconnected";
    updateConnectionStatus("error");
  };
}

/**
 * Update connection status in header
 */
const STATUS_CONFIG: Record<string, { text: string | (() => string); add: string; remove: string[] }> = {
  connected: { text: "Connected", add: "connected", remove: ["error", "reconnecting"] },
  disconnected: { text: () => state.reconnectAttempts > 0 ? "Reconnecting..." : "Disconnected", add: "reconnecting", remove: ["connected"] },
  error: { text: "Connection Error", add: "error", remove: ["connected", "reconnecting"] },
  failed: { text: "Connection Failed", add: "error", remove: ["connected", "reconnecting"] },
};

function updateConnectionStatus(status: string) {
  if (!statusElement) {
    console.error("Status element not initialized");
    return;
  }

  const config = STATUS_CONFIG[status];
  if (!config) return;

  statusElement.textContent = typeof config.text === "function" ? config.text() : config.text;
  statusElement.classList.add(config.add);
  statusElement.classList.remove(...config.remove);
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
        // If pong is received, this timeout will be cleared in onmessage handler
        pendingHeartbeatTimeout = setTimeout(() => {
          console.log("Heartbeat timeout - no pong received, closing connection");
          pendingHeartbeatTimeout = null;
          // No pong received - connection is dead, force reconnection
          if (state.ws) {
            state.ws.close();
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
  // Also clear any pending timeout
  if (pendingHeartbeatTimeout !== null) {
    clearTimeout(pendingHeartbeatTimeout);
    pendingHeartbeatTimeout = null;
  }
}

/**
 * Check if WebSocket is connected
 */
function isConnected(): boolean {
  return state.ws !== null &&
         state.ws.readyState === WebSocket.OPEN &&
         state.connectionState === "connected";
}

/**
 * Send message to server
 */
function sendWsMessage(type: string, content: string = ""): boolean {
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
    state.ws!.send(JSON.stringify(message));
    console.log("Message sent:", type);
    return true;
  } catch (error) {
    console.error("Error sending message:", error);
    return false;
  }
}

// =============================================================================
// MESSAGE HANDLING & ORCHESTRATION
// =============================================================================

/**
 * Handle all incoming messages from server
 */
function handleMessage(message: any) {
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

    case "reload_page":
      console.log("Hot reload triggered:", message.reason);
      // Add a brief delay to allow any pending operations to complete
      setTimeout(() => {
        // Force reload bypassing cache
        window.location.reload();
      }, 100);
      break;

    default:
      console.log("Unknown message type:", message.type);
  }
}

/**
 * Handle session info (includes history)
 */
function handleSessionInfo(message: any) {
  // Update token info if available
  updateTokenInfoFromContext(message.contextSize);

  // Clear output and display history
  clearOutput();

  if (message.history && message.history.length > 0) {
    // Render history
    message.history.forEach((entry: any) => {
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

  scrollToBottom();
  state.isFirstConnection = false;
}

/**
 * Send message with connection validation
 */
function sendMessage(type: string, content: string = ""): boolean {
  const success = sendWsMessage(type, content);

  if (!success) {
    // Show user feedback for failed task submissions
    if (type === "task" && content) {
      addSystemMessage("Cannot send message - not connected to server", "error");
    }
  }

  return success;
}

/**
 * Submit task with connection validation
 */
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

/**
 * Stop task
 */
function stopTask() {
  sendMessage("stop_task");
}

// =============================================================================
// INITIALIZATION
// =============================================================================

// DOM elements
const outputEl = document.getElementById("output")!;
const statusEl = document.getElementById("status")!;
const tokenInfoEl = document.getElementById("tokenInfo")!;
const taskInputEl = document.getElementById("taskInput") as HTMLTextAreaElement;
const submitBtnEl = document.getElementById("submitBtn")!;
const stopBtnEl = document.getElementById("stopBtn")!;

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

// Initialize UI module variables
output = outputEl;
submitBtn = submitBtnEl;
stopBtn = stopBtnEl;
taskInput = taskInputEl;
tokenInfo = tokenInfoEl;
statusElement = statusEl;

// Connect on load
connect();
