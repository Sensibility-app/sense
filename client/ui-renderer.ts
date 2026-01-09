/**
 * UI rendering functions
 *
 * Handles all DOM manipulation and message rendering
 */

import { state } from "./state.ts";

// DOM elements set by client
let output: HTMLElement;
let submitBtn: HTMLElement;
let stopBtn: HTMLElement;
let taskInput: HTMLInputElement;
let tokenInfo: HTMLElement;

/**
 * Initialize UI renderer with required DOM elements
 */
export function setupUI(
  outputEl: HTMLElement,
  submitBtnEl: HTMLElement,
  stopBtnEl: HTMLElement,
  taskInputEl: HTMLInputElement,
  tokenInfoEl: HTMLElement
) {
  output = outputEl;
  submitBtn = submitBtnEl;
  stopBtn = stopBtnEl;
  taskInput = taskInputEl;
  tokenInfo = tokenInfoEl;
}

/**
 * Scroll output to bottom
 */
export function scrollToBottom() {
  if (output) {
    output.scrollTop = output.scrollHeight;
  }
}

/**
 * Add user message to output
 */
export function addUserMessage(content: string) {
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

/**
 * Add assistant message to output (for history)
 */
export function addAssistantMessage(content: string) {
  const message = document.createElement("div");
  message.className = "message assistant";

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "Assistant";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";

  try {
    messageContent.innerHTML = (window as any).marked.parse(content);
  } catch (e) {
    console.error("Markdown parse error:", e);
    messageContent.textContent = content;
  }

  message.appendChild(label);
  message.appendChild(messageContent);
  output.appendChild(message);
  scrollToBottom();
}

/**
 * Start streaming assistant message
 */
export function startAssistantMessage() {
  // Finish any existing message first
  finishAssistantMessage();

  state.currentAssistantMessage = document.createElement("div");
  state.currentAssistantMessage.className = "message assistant";
  state.currentAssistantText = "";

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "Assistant";

  const messageContent = document.createElement("div");
  messageContent.className = "message-content streaming-cursor";
  messageContent.textContent = "";

  state.currentAssistantMessage.appendChild(label);
  state.currentAssistantMessage.appendChild(messageContent);
  output.appendChild(state.currentAssistantMessage);
  scrollToBottom();
}

/**
 * Append text to streaming assistant message
 */
export function appendToAssistantMessage(text: string) {
  if (!state.currentAssistantMessage) {
    startAssistantMessage();
  }

  state.currentAssistantText += text;
  const content = state.currentAssistantMessage!.querySelector(".message-content");

  // Try to render markdown in real-time
  try {
    content!.innerHTML = (window as any).marked.parse(state.currentAssistantText);
  } catch (e) {
    // If parsing fails (incomplete markdown), show raw text
    content!.textContent = state.currentAssistantText;
  }

  scrollToBottom();
}

/**
 * Finish streaming assistant message
 */
export function finishAssistantMessage() {
  if (state.currentAssistantMessage) {
    const content = state.currentAssistantMessage.querySelector(".message-content");
    content!.classList.remove("streaming-cursor");

    // Final markdown parse
    if (state.currentAssistantText.trim()) {
      try {
        content!.innerHTML = (window as any).marked.parse(state.currentAssistantText);
      } catch (e) {
        console.error("Markdown parse error:", e);
        content!.textContent = state.currentAssistantText;
      }
    }

    state.currentAssistantMessage = null;
    state.currentAssistantText = "";
  }
}

/**
 * Add system message to output
 */
export function addSystemMessage(content: string, level: string = "info") {
  const message = document.createElement("div");
  message.className = `message system ${level === "error" ? "error" : ""}`;

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  messageContent.textContent = content;

  message.appendChild(messageContent);
  output.appendChild(message);
  scrollToBottom();
}

/**
 * Add thinking block to output
 */
export function addThinkingBlock(content: string) {
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
    arrow!.textContent = thinkingContent.classList.contains("collapsed") ? "▶" : "▼";
  };

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
 * Add tool use to output
 */
export function addToolUse(toolName: string, toolId: string, toolInput: any) {
  // Finish any streaming assistant message before showing tool
  finishAssistantMessage();

  const toolBlock = document.createElement("div");
  toolBlock.className = "tool-use";
  toolBlock.dataset.toolId = toolId;

  const paramString = formatToolParams(toolInput);

  const header = document.createElement("div");
  header.className = "tool-header";
  header.innerHTML = `<span class="tool-name">${toolName}${paramString}</span><span style="margin-left: auto">▼</span>`;

  toolBlock.appendChild(header);
  output.appendChild(toolBlock);

  state.currentToolUse = toolBlock;
  scrollToBottom();
}

/**
 * Add tool result to output
 */
export function addToolResult(toolId: string, content: string, isError: boolean) {
  const toolBlock = document.querySelector(`[data-tool-id="${toolId}"]`) as HTMLElement;
  if (!toolBlock) {
    console.warn("Tool block not found for:", toolId);
    return;
  }

  const result = document.createElement("div");
  result.className = `tool-result ${isError ? "error" : ""}`;
  result.textContent = content;

  const header = toolBlock.querySelector(".tool-header") as HTMLElement;

  // Make it collapsible
  header.onclick = () => {
    result.classList.toggle("collapsed");
    const arrow = header.querySelector("span:last-child");
    arrow!.textContent = result.classList.contains("collapsed") ? "▶" : "▼";
  };

  toolBlock.appendChild(result);
  state.currentToolUse = null;
  scrollToBottom();
}

/**
 * Add tool from history (with result already available)
 */
export function addToolFromHistory(entry: any) {
  const toolBlock = document.createElement("div");
  toolBlock.className = "tool-use";

  if (entry.toolName && entry.toolInput) {
    const paramString = formatToolParams(entry.toolInput);

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
        arrow!.textContent = result.classList.contains("collapsed") ? "▶" : "▼";
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

/**
 * Set processing state and update UI
 */
export function setProcessing(processing: boolean) {
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
export function updateTokenInfo(formatted: string) {
  if (formatted) {
    tokenInfo.textContent = formatted;
    tokenInfo.style.display = "block";
  }
}

/**
 * Update token info from context size
 */
export function updateTokenInfoFromContext(contextSize: any) {
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
export function clearOutput() {
  output.innerHTML = "";
}
