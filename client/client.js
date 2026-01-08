// DOM elements
const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const tokenInfo = document.getElementById("tokenInfo");
const taskInput = document.getElementById("taskInput");
const submitBtn = document.getElementById("submitBtn");
const stopBtn = document.getElementById("stopBtn");

// State
let ws;
let isProcessing = false;
let currentAssistantMessage = null;
let currentAssistantText = "";
let currentToolUse = null;
let isFirstConnection = true;

// WebSocket connection
function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.classList.add("connected");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected";
    statusEl.classList.remove("connected");
    setProcessing(false);
    setTimeout(connect, 2000); // Reconnect after 2s
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

// Handle all incoming messages from server
function handleMessage(message) {
  switch (message.type) {
    case "session_info":
      handleSessionInfo(message);
      break;

    case "connection_status":
      // Already handled by ws.onopen/onclose
      break;

    case "processing_status":
      setProcessing(message.isProcessing);
      break;

    case "token_usage":
      if (message.formatted) {
        tokenInfo.textContent = message.formatted;
        tokenInfo.style.display = "block";
      }
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
  if (message.contextSize) {
    if (message.contextSize.estimatedTokens > 0) {
      tokenInfo.textContent = `~${message.contextSize.estimatedTokens.toLocaleString()} tokens`;
      tokenInfo.style.display = "block";
    } else {
      // Hide token display when tokens are 0 (session cleared)
      tokenInfo.style.display = "none";
    }
  }

  // Clear output and display history
  output.innerHTML = "";

  if (message.history && message.history.length > 0) {
    // Render history
    message.history.forEach(entry => {
      if (entry.type === "user") {
        addUserMessage(entry.content);
      } else if (entry.type === "assistant") {
        addAssistantMessage(entry.content);
      } else if (entry.type === "tool") {
        addToolFromHistory(entry);
      } else if (entry.type === "thinking") {
        addThinkingBlock(entry.content);
      }
    });
  }
  
  // All system messages now come from server - client just displays them

  scrollToBottom();
  isFirstConnection = false;
}

// User message
function addUserMessage(content) {
  const message = document.createElement("div");
  message.className = "message user";

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "You";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  messageContent.textContent = content;

  message.appendChild(label);
  message.appendChild(messageContent);
  output.appendChild(message);
  scrollToBottom();
}

// Assistant message (complete, for history)
function addAssistantMessage(content) {
  const message = document.createElement("div");
  message.className = "message assistant";

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "Assistant";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";

  try {
    messageContent.innerHTML = marked.parse(content);
  } catch (e) {
    console.error("Markdown parse error:", e);
    messageContent.textContent = content;
  }

  message.appendChild(label);
  message.appendChild(messageContent);
  output.appendChild(message);
  scrollToBottom();
}

// Start streaming assistant message
function startAssistantMessage() {
  // Finish any existing message first
  finishAssistantMessage();

  currentAssistantMessage = document.createElement("div");
  currentAssistantMessage.className = "message assistant";
  currentAssistantText = "";

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "Assistant";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content streaming-cursor";
  messageContent.textContent = "";

  currentAssistantMessage.appendChild(label);
  currentAssistantMessage.appendChild(messageContent);
  output.appendChild(currentAssistantMessage);
  scrollToBottom();
}

// Append text to streaming assistant message
function appendToAssistantMessage(text) {
  if (!currentAssistantMessage) {
    startAssistantMessage();
  }

  currentAssistantText += text;
  const content = currentAssistantMessage.querySelector(".message-content");

  // Try to render markdown in real-time
  try {
    content.innerHTML = marked.parse(currentAssistantText);
  } catch (e) {
    // If parsing fails (incomplete markdown), show raw text
    content.textContent = currentAssistantText;
  }

  scrollToBottom();
}

// Finish streaming assistant message
function finishAssistantMessage() {
  if (currentAssistantMessage) {
    const content = currentAssistantMessage.querySelector(".message-content");
    content.classList.remove("streaming-cursor");

    // Final markdown parse
    if (currentAssistantText.trim()) {
      try {
        content.innerHTML = marked.parse(currentAssistantText);
      } catch (e) {
        console.error("Markdown parse error:", e);
        content.textContent = currentAssistantText;
      }
    }

    currentAssistantMessage = null;
    currentAssistantText = "";
  }
}

// System message
function addSystemMessage(content, level = "info") {
  const message = document.createElement("div");
  message.className = `message system ${level === "error" ? "error" : ""}`;

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  messageContent.textContent = content;

  message.appendChild(messageContent);
  output.appendChild(message);
  scrollToBottom();
}

// Thinking block
function addThinkingBlock(content) {
  const block = document.createElement("div");
  block.className = "thinking-block";

  const header = document.createElement("div");
  header.className = "thinking-header";
  header.innerHTML = '<span>💭 Thinking</span><span>▼</span>';

  const thinkingContent = document.createElement("div");
  thinkingContent.className = "thinking-content collapsed";
  thinkingContent.textContent = content;

  header.onclick = () => {
    thinkingContent.classList.toggle("collapsed");
    const arrow = header.querySelector("span:last-child");
    arrow.textContent = thinkingContent.classList.contains("collapsed") ? "▶" : "▼";
  };

  block.appendChild(header);
  block.appendChild(thinkingContent);
  output.appendChild(block);
  scrollToBottom();
}

// Tool use
function addToolUse(toolName, toolId, toolInput) {
  // Finish any streaming assistant message before showing tool
  finishAssistantMessage();

  const toolBlock = document.createElement("div");
  toolBlock.className = "tool-use";
  toolBlock.dataset.toolId = toolId;

  // Format tool input parameters
  let paramString = "";
  if (toolInput && typeof toolInput === "object") {
    const params = Object.entries(toolInput)
      .map(([key, value]) => {
        if (typeof value === "string") {
          const displayValue = value.length > 50 ? value.substring(0, 50) + "..." : value;
          return `${key}="${displayValue}"`;
        }
        return `${key}=${JSON.stringify(value)}`;
      })
      .join(", ");
    paramString = params ? `(${params})` : "";
  }

  const header = document.createElement("div");
  header.className = "tool-header";
  header.innerHTML = `<span class="tool-name">${toolName}${paramString}</span><span style="margin-left: auto">▼</span>`;

  toolBlock.appendChild(header);
  output.appendChild(toolBlock);

  currentToolUse = toolBlock;
  scrollToBottom();
}

// Tool result
function addToolResult(toolId, content, isError) {
  const toolBlock = document.querySelector(`[data-tool-id="${toolId}"]`);
  if (!toolBlock) {
    console.warn("Tool block not found for:", toolId);
    return;
  }

  const result = document.createElement("div");
  result.className = `tool-result ${isError ? "error" : ""}`;
  result.textContent = content;

  const header = toolBlock.querySelector(".tool-header");

  // Make it collapsible
  header.onclick = () => {
    result.classList.toggle("collapsed");
    const arrow = header.querySelector("span:last-child");
    arrow.textContent = result.classList.contains("collapsed") ? "▶" : "▼";
  };

  toolBlock.appendChild(result);
  currentToolUse = null;
  scrollToBottom();
}

// Tool from history (with result already available)
function addToolFromHistory(entry) {
  const toolBlock = document.createElement("div");
  toolBlock.className = "tool-use";

  if (entry.toolName && entry.toolInput) {
    // Format parameters
    let paramString = "";
    if (entry.toolInput && typeof entry.toolInput === "object") {
      const params = Object.entries(entry.toolInput)
        .map(([key, value]) => {
          if (typeof value === "string") {
            const displayValue = value.length > 50 ? value.substring(0, 50) + "..." : value;
            return `${key}="${displayValue}"`;
          }
          return `${key}=${JSON.stringify(value)}`;
        })
        .join(", ");
      paramString = params ? `(${params})` : "";
    }

    const header = document.createElement("div");
    header.className = "tool-header";

    // Add result if available
    if (entry.toolResult !== undefined) {
      header.innerHTML = `<span class="tool-name">${entry.toolName}${paramString}</span><span style="margin-left: auto">▼</span>`;

      const result = document.createElement("div");
      result.className = `tool-result ${entry.toolError ? "error" : ""}`;
      result.textContent = entry.toolResult;

      // Make it collapsible
      header.onclick = () => {
        result.classList.toggle("collapsed");
        const arrow = header.querySelector("span:last-child");
        arrow.textContent = result.classList.contains("collapsed") ? "▶" : "▼";
      };

      toolBlock.appendChild(header);
      toolBlock.appendChild(result);
    } else {
      // No result available
      header.innerHTML = `<span class="tool-name">${entry.toolName}${paramString}</span>`;
      toolBlock.appendChild(header);
    }
  } else {
    // Fallback for old format
    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = `<span class="tool-name">${entry.content}</span>`;
    toolBlock.appendChild(header);
  }

  output.appendChild(toolBlock);
}

// Continue prompt for interrupted tasks


// Processing state
function setProcessing(processing) {
  isProcessing = processing;

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

// Scroll to bottom
function scrollToBottom() {
  output.scrollTop = output.scrollHeight;
}

// Send message
function sendMessage(type, content = "") {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const message = content ? { type, content } : { type };
    ws.send(JSON.stringify(message));
  }
}

// Submit task
function submitTask() {
  const task = taskInput.value.trim();
  if (!task || isProcessing) return;

  // Check for slash commands
  if (task === "/clear") {
    sendMessage("clear_session");
    taskInput.value = "";
    return;
  }

  sendMessage("task", task);
  taskInput.value = "";
  taskInput.style.height = "20px"; // Reset height
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

// Connect on load
connect();
