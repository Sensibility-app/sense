/**
 * UI Rendering Module
 *
 * Handles all DOM manipulation and rendering logic.
 * Encapsulates message rendering, UI state updates, and output management.
 */

import { state } from "./state.ts";

// =============================================================================
// STATUS CONFIGURATION
// =============================================================================

const STATUS_CONFIG: Record<
  string,
  { text: string | (() => string); add: string; remove: string[] }
> = {
  connected: {
    text: "Connected",
    add: "connected",
    remove: ["error", "reconnecting"],
  },
  connecting: {
    text: "Connecting...",
    add: "reconnecting",
    remove: ["connected", "error"],
  },
  disconnected: {
    text: () =>
      state.connection.reconnectAttempts > 0
        ? "Reconnecting..."
        : "Disconnected",
    add: "reconnecting",
    remove: ["connected"],
  },
  error: {
    text: "Connection Error",
    add: "error",
    remove: ["connected", "reconnecting"],
  },
  failed: {
    text: "Connection Failed",
    add: "error",
    remove: ["connected", "reconnecting"],
  },
};

// =============================================================================
// RENDERER CLASS
// =============================================================================

export class Renderer {
  constructor(
    private output: HTMLElement,
    private statusElement: HTMLElement,
    private tokenInfo: HTMLElement,
    private taskInput: HTMLTextAreaElement,
    private submitBtn: HTMLElement,
    private stopBtn: HTMLElement
  ) {
    // Configure marked when it becomes available (loaded async)
    if ((window as any).marked) {
      this.configureMarked();
    } else {
      // Wait for marked to load
      window.addEventListener('DOMContentLoaded', () => {
        if ((window as any).marked) {
          this.configureMarked();
        }
      });
    }
  }

  /**
   * Configure marked options for security and better rendering
   */
  private configureMarked(): void {
    try {
      (window as any).marked.setOptions({
        breaks: true,
        gfm: true,
        headerIds: false,
        mangle: false
      });
    } catch (e) {
      console.error("Failed to configure marked:", e);
    }
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  /**
   * Check if user is near the bottom of the output
   */
  private isNearBottom(): boolean {
    if (!this.output) return false;
    const threshold = 150; // pixels from bottom
    const position = this.output.scrollTop + this.output.clientHeight;
    const bottom = this.output.scrollHeight;
    return bottom - position < threshold;
  }

  /**
   * Scroll output to bottom with smooth animation (only if user is already near bottom)
   */
  scrollToBottom(): void {
    if (this.output && this.isNearBottom()) {
      this.output.scrollTo({
        top: this.output.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  /**
   * Clear output
   */
  clearOutput(): void {
    this.output.innerHTML = "";
  }

  /**
   * Parse markdown and render to HTML element with error handling
   */
  private parseMarkdown(text: string, element: HTMLElement): void {
    try {
      element.innerHTML = (window as any).marked.parse(text);
    } catch (e) {
      console.error("Markdown parse error:", e);
      element.textContent = text;
    }
  }

  // ===========================================================================
  // MESSAGE RENDERING
  // ===========================================================================

  /**
   * Create message element (base renderer for all message types)
   */
  private createMessage(
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
      this.parseMarkdown(content, messageContent);
    } else {
      messageContent.textContent = content;
    }

    message.appendChild(messageContent);
    return message;
  }

  /**
   * Add message to output (unified function)
   */
  private addMessage(
    type: "user" | "assistant" | "system",
    content: string,
    options = {}
  ): void {
    const message = this.createMessage(type, content, options);
    this.output.appendChild(message);
    this.scrollToBottom();
  }

  /**
   * Add user message to output
   */
  addUserMessage(content: string): void {
    this.addMessage("user", content, { parseMarkdown: true });
  }

  /**
   * Add assistant message to output (for history)
   */
  addAssistantMessage(content: string): void {
    this.addMessage("assistant", content, { parseMarkdown: true });
  }

  /**
   * Add system message to output
   */
  addSystemMessage(content: string, level: string = "info"): void {
    this.addMessage("system", content, { level });
  }

  /**
   * Start streaming assistant message
   */
  startAssistantMessage(): void {
    // Finish any existing message first
    this.finishAssistantMessage();

    state.render.currentAssistantMessage = document.createElement("div");
    state.render.currentAssistantMessage.className = "message assistant";
    state.render.currentAssistantText = "";

    const messageContent = document.createElement("div");
    messageContent.className = "message-content streaming-cursor";
    messageContent.textContent = "";

    state.render.currentAssistantMessage.appendChild(messageContent);
    this.output.appendChild(state.render.currentAssistantMessage);
    this.scrollToBottom();
  }

  /**
   * Append text to streaming assistant message
   */
  appendToAssistantMessage(text: string): void {
    if (!state.render.currentAssistantMessage) {
      this.startAssistantMessage();
    }

    state.render.currentAssistantText += text;
    const content = state.render.currentAssistantMessage!.querySelector(
      ".message-content"
    ) as HTMLElement;

    // Try to render markdown in real-time (falls back to text if incomplete)
    this.parseMarkdown(state.render.currentAssistantText, content);

    // Only scroll if user is following along
    this.scrollToBottom();
  }

  /**
   * Finish streaming assistant message
   */
  finishAssistantMessage(): void {
    if (state.render.currentAssistantMessage) {
      const content = state.render.currentAssistantMessage.querySelector(
        ".message-content"
      ) as HTMLElement;
      content.classList.remove("streaming-cursor");

      // Final markdown parse
      if (state.render.currentAssistantText.trim()) {
        this.parseMarkdown(state.render.currentAssistantText, content);
      }

      state.render.currentAssistantMessage = null;
      state.render.currentAssistantText = "";
    }
  }

  /**
   * Start streaming thinking block
   */
  startThinkingBlock(): void {
    // Finish any existing thinking block first
    this.finishThinkingBlock();

    state.render.currentThinkingBlock = document.createElement("div");
    state.render.currentThinkingBlock.className = "thinking-block";
    state.render.currentThinkingText = "";

    const header = document.createElement("div");
    header.className = "thinking-header";
    header.innerHTML = '<span>💭 Thinking</span><span>▼</span>';

    const thinkingContent = document.createElement("div");
    thinkingContent.className = "thinking-content";
    thinkingContent.textContent = "";

    // Make header collapsible
    header.onclick = () => {
      thinkingContent.classList.toggle("collapsed");
      const arrow = header.querySelector("span:last-child");
      arrow!.textContent = thinkingContent.classList.contains("collapsed")
        ? "▶"
        : "▼";
    };

    state.render.currentThinkingBlock.appendChild(header);
    state.render.currentThinkingBlock.appendChild(thinkingContent);
    this.output.appendChild(state.render.currentThinkingBlock);
    this.scrollToBottom();
  }

  /**
   * Append text to streaming thinking block
   */
  appendToThinkingBlock(text: string): void {
    if (!state.render.currentThinkingBlock) {
      this.startThinkingBlock();
    }

    state.render.currentThinkingText += text;
    const content = state.render.currentThinkingBlock!.querySelector(
      ".thinking-content"
    ) as HTMLElement;

    content.textContent = state.render.currentThinkingText;
    this.scrollToBottom();
  }

  /**
   * Finish streaming thinking block
   */
  finishThinkingBlock(): void {
    if (state.render.currentThinkingBlock) {
      state.render.currentThinkingBlock = null;
      state.render.currentThinkingText = "";
    }
  }

  /**
   * Add tool execution indicator (shown while tool runs)
   */
  addToolExecuting(toolName: string, toolId: string): void {
    const indicator = document.createElement("div");
    indicator.className = "tool-executing";
    indicator.id = `tool-${toolId}`;
    indicator.innerHTML = `
      <span class="tool-icon">⚙</span>
      <span class="tool-label">${toolName}</span>
      <span class="spinner"></span>
    `;
    this.output.appendChild(indicator);
    this.scrollToBottom();
  }

  /**
   * Remove tool execution indicator (when complete)
   */
  removeToolExecuting(toolId: string): void {
    const indicator = document.getElementById(`tool-${toolId}`);
    if (indicator) {
      indicator.remove();
    }
  }

  // ===========================================================================
  // UI STATE UPDATES
  // ===========================================================================

  /**
   * Set processing state and update UI
   */
  setProcessing(processing: boolean): void {
    state.isProcessing = processing;

    // Don't allow processing if not connected
    if (processing && state.connection.status !== "connected") {
      state.isProcessing = false;
      processing = false;
    }

    if (processing) {
      this.submitBtn.style.display = "none";
      this.stopBtn.style.display = "flex";
      // Don't disable textarea - let users type next message
      // Add visual class to input wrapper instead
      const wrapper = this.taskInput.parentElement;
      if (wrapper) {
        wrapper.classList.add("processing");
      }
    } else {
      this.submitBtn.style.display = "flex";
      this.stopBtn.style.display = "none";
      const wrapper = this.taskInput.parentElement;
      if (wrapper) {
        wrapper.classList.remove("processing");
      }
      this.taskInput.focus();
    }
  }

  /**
   * Update connection status in header
   */
  updateConnectionStatus(status: string): void {
    if (!this.statusElement) {
      console.error("Status element not initialized");
      return;
    }

    const config = STATUS_CONFIG[status];
    if (!config) return;

    this.statusElement.textContent =
      typeof config.text === "function" ? config.text() : config.text;
    this.statusElement.classList.add(config.add);
    this.statusElement.classList.remove(...config.remove);
  }

  /**
   * Update token info display with simplified formatting
   */
  updateTokenInfo(input: string | { estimatedTokens: number }): void {
    if (typeof input === "string") {
      // Pre-formatted string from token_usage message - parse and simplify
      const match = input.match(/~?([\d,]+)/);
      if (match) {
        const tokens = parseInt(match[1].replace(/,/g, ""));
        this.tokenInfo.textContent = this.formatTokenCount(tokens);
        this.tokenInfo.style.display = "block";
      }
    } else if (input && typeof input.estimatedTokens === "number") {
      // Context size object from session info
      if (input.estimatedTokens > 0) {
        this.tokenInfo.textContent = this.formatTokenCount(input.estimatedTokens);
        this.tokenInfo.style.display = "block";
      } else {
        this.tokenInfo.style.display = "none";
      }
    }
  }

  /**
   * Format token count with K abbreviation for readability
   * Examples: 1234 -> "1.2K", 45678 -> "46K", 123 -> "123"
   */
  private formatTokenCount(tokens: number): string {
    if (tokens >= 10000) {
      return `~${Math.round(tokens / 1000)}K`;
    } else if (tokens >= 1000) {
      return `~${(tokens / 1000).toFixed(1)}K`;
    } else {
      return `~${tokens}`;
    }
  }
}
