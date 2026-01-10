/**
 * Message Handler Module
 *
 * Handles message routing, business logic, and task orchestration.
 * Coordinates between renderer (UI updates) and connection (server communication).
 */

import { state } from "./state.ts";
import { Renderer } from "./renderer.ts";
import { ConnectionManager } from "./connection.ts";

// =============================================================================
// MESSAGE HANDLER CLASS
// =============================================================================

export class MessageHandler {
  constructor(
    private renderer: Renderer,
    private connection: ConnectionManager,
    private taskInput: HTMLTextAreaElement
  ) {}

  // ===========================================================================
  // MESSAGE ROUTING
  // ===========================================================================

  /**
   * Handle all incoming messages from server
   */
  handleMessage(message: any): void {
    switch (message.type) {
      case "session_info":
        this.handleSessionInfo(message);
        break;

      case "connection_status":
        // Server-side connection status updates (handled by connection module)
        // Connection module automatically updates status based on WebSocket state
        break;

      case "processing_status":
        this.renderer.setProcessing(message.isProcessing);
        break;

      case "token_usage":
        this.renderer.updateTokenInfo(message.formatted);
        break;

      case "user_message":
        this.renderer.addUserMessage(message.content);
        break;

      case "assistant_response":
        this.renderer.startAssistantMessage();
        if (message.content) {
          this.renderer.appendToAssistantMessage(message.content);
        }
        break;

      case "text_delta":
        this.renderer.appendToAssistantMessage(message.content);
        break;

      case "tool_start":
        this.renderer.addToolExecuting(message.toolName, message.toolId);
        break;

      case "tool_complete":
        this.renderer.removeToolExecuting(message.toolId);
        break;

      case "thinking":
        this.renderer.addThinkingBlock(message.content);
        break;

      case "system":
        this.renderer.addSystemMessage(message.content, message.level);
        break;

      case "task_complete":
        this.renderer.finishAssistantMessage();
        this.renderer.scrollToBottom();
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

  // ===========================================================================
  // SPECIFIC MESSAGE HANDLERS
  // ===========================================================================

  /**
   * Handle session info (includes history)
   */
  private handleSessionInfo(message: any): void {
    // Update token info if available
    this.renderer.updateTokenInfo(message.contextSize);

    // Clear output and display history
    this.renderer.clearOutput();

    if (message.history && message.history.length > 0) {
      // Render history
      message.history.forEach((entry: any) => {
        if (entry.type === "user") {
          this.renderer.addUserMessage(entry.content);
        } else if (entry.type === "assistant") {
          this.renderer.addAssistantMessage(entry.content);
        } else if (entry.type === "system") {
          this.renderer.addSystemMessage(entry.content, "info");
        } else if (entry.type === "thinking") {
          this.renderer.addThinkingBlock(entry.content);
        }
      });
    }

    this.renderer.scrollToBottom();
    state.connection.isFirstConnection = false;
  }

  // ===========================================================================
  // TASK ORCHESTRATION
  // ===========================================================================

  /**
   * Submit task with connection validation
   */
  submitTask(): void {
    const task = this.taskInput.value.trim();
    if (!task || state.isProcessing) return;

    // Check connection state before sending
    if (state.connection.status !== "connected") {
      this.renderer.addSystemMessage(
        "Cannot send task - not connected to server",
        "error"
      );
      return;
    }

    // Check for slash commands
    if (this.handleSlashCommand(task)) {
      return;
    }

    // Send task message
    if (this.sendMessage("task", task)) {
      this.taskInput.value = "";
      this.taskInput.style.height = "40px"; // Reset height to default
    }
  }

  /**
   * Stop task
   */
  stopTask(): void {
    this.sendMessage("stop_task");
  }

  /**
   * Clear session
   */
  clearSession(): void {
    if (this.sendMessage("clear_session")) {
      this.taskInput.value = "";
      this.taskInput.style.height = "20px";
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Handle slash commands
   * @returns true if command was handled, false otherwise
   */
  private handleSlashCommand(task: string): boolean {
    if (task === "/clear") {
      this.clearSession();
      return true;
    }
    return false;
  }

  /**
   * Send message with connection validation
   */
  private sendMessage(type: string, content: string = ""): boolean {
    const success = this.connection.send(type, content);

    if (!success) {
      // Show user feedback for failed task submissions
      if (type === "task" && content) {
        this.renderer.addSystemMessage(
          "Cannot send message - not connected to server",
          "error"
        );
      }
    }

    return success;
  }
}
