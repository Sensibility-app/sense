/**
 * WebSocket handler
 * Manages WebSocket connections, message routing, and client broadcasting
 */

import { log, error } from "./logger.ts";
import { continueConversation } from "./claude.ts";
import { archiveCurrentSession, formatSessionHistory, type PersistentSession } from "./persistent-session.ts";
import { type ClientMessage, type ServerMessage, formatTokenUsage } from "./server-types.ts";
import type { AgentContext, BroadcastFn } from "./agent-context.ts";

/**
 * WebSocket handler class
 * Encapsulates all WebSocket connection logic and message handling
 */
export class WebSocketHandler {
  private connectedClients = new Set<WebSocket>();

  constructor(
    private globalSession: PersistentSession,
    private agent: AgentContext
  ) {}

  /**
   * Broadcast message to all connected clients
   */
  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          error("Failed to send to client:", err);
        }
      }
    }
  }

  /**
   * Handle agent events and broadcast to clients
   */
  handleAgentEvent(chunk: any): void {
    if (chunk.type === "text_delta") {
      this.broadcast({ type: "text_delta", content: chunk.content });
    } else if (chunk.type === "tool_use") {
      this.broadcast({
        type: "tool_use",
        toolName: chunk.toolName!,
        toolId: chunk.toolId!,
        toolInput: chunk.toolInput,
      });
    } else if (chunk.type === "tool_result") {
      this.broadcast({
        type: "tool_result",
        toolId: chunk.toolId || crypto.randomUUID(),
        content: chunk.content,
        isError: chunk.isError || false,
      });
    } else if (chunk.type === "token_usage" && chunk.tokenUsage) {
      this.globalSession.addTokenUsage(chunk.tokenUsage);
      const totalUsage = this.globalSession.getTokenUsage();
      this.broadcast({
        type: "token_usage",
        usage: totalUsage,
        formatted: formatTokenUsage(totalUsage),
      });
    } else if (chunk.type === "complete") {
      this.broadcast({
        type: "task_complete",
        summary: "Task completed"
      });
    }
  }

  /**
   * Git status command
   */
  private async runGitStatus(): Promise<void> {
    this.broadcast({ type: "processing_status", isProcessing: true, message: "Running git status..." });

    try {
      const cmd = new Deno.Command("git", { args: ["status"], cwd: Deno.cwd(), stdout: "piped", stderr: "piped" });
      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      this.broadcast({ type: "assistant_response", content: code === 0 ? output : errorOutput });
      this.broadcast({ type: "task_complete", summary: "Git status complete" });
    } catch (error) {
      this.broadcast({ type: "system", content: `Git error: ${error instanceof Error ? error.message : String(error)}`, level: "error" });
    } finally {
      this.broadcast({ type: "processing_status", isProcessing: false });
    }
  }

  /**
   * Git diff command
   */
  private async runGitDiff(): Promise<void> {
    this.broadcast({ type: "processing_status", isProcessing: true, message: "Running git diff..." });

    try {
      const cmd = new Deno.Command("git", { args: ["diff"], cwd: Deno.cwd(), stdout: "piped", stderr: "piped" });
      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      if (code === 0 && output) {
        this.broadcast({ type: "assistant_response", content: output });
      } else if (code === 0 && !output) {
        this.broadcast({ type: "system", content: "No changes to show", level: "info" });
      } else {
        this.broadcast({ type: "system", content: `Git diff error: ${errorOutput}`, level: "error" });
      }

      this.broadcast({ type: "task_complete", summary: "Git diff complete" });
    } catch (error) {
      this.broadcast({ type: "system", content: `Git error: ${error instanceof Error ? error.message : String(error)}`, level: "error" });
    } finally {
      this.broadcast({ type: "processing_status", isProcessing: false });
    }
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(socket: WebSocket): void {
    log("Client connected");

    // Add to connected clients
    this.connectedClients.add(socket);
    log(`Total connected clients: ${this.connectedClients.size}`);

    // Helper to send to just this client
    const sendToClient = (msg: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(msg));
        } catch (err) {
          error("Failed to send to client:", err);
        }
      }
    };

    // Send initial session info
    const sendSessionInfo = () => {
      const messages = this.globalSession.getMessages();
      const tokenUsage = this.globalSession.getTokenUsage();
      const sizeInfo = this.globalSession.getSessionSizeInfo();
      const history = formatSessionHistory(messages);

      sendToClient({
        type: "session_info",
        messageCount: messages.length,
        tokenUsage,
        history,
        isTaskRunning: this.agent.isRunning(),
        contextSize: {
          estimatedTokens: sizeInfo.estimatedTokens,
          bytes: sizeInfo.bytes,
        },
      });
    };

    // Send session info immediately if socket is already OPEN
    if (socket.readyState === WebSocket.OPEN) {
      sendSessionInfo();
    } else {
      socket.onopen = () => {
        sendSessionInfo();
      };
    }

    socket.onmessage = async (event) => {
      try {
        const message: ClientMessage = JSON.parse(event.data);

        // Handle ping messages for heartbeat
        if (message.type === "ping") {
          sendToClient({ type: "pong" as any });
          return;
        }

        if (message.type === "stop_task") {
          if (this.agent.isRunning()) {
            this.agent.requestStop();
            this.broadcast({
              type: "system",
              content: "Stopping task...",
              level: "info",
            });
          } else {
            sendToClient({
              type: "system",
              content: "No task running",
              level: "info",
            });
          }
          return;
        }

        if (message.type === "archive_session" || message.type === "clear_session") {
          await archiveCurrentSession();
          await this.globalSession.clear();

          const tokenUsage = this.globalSession.getTokenUsage();
          const sizeInfo = this.globalSession.getSessionSizeInfo();

          // Send state update
          this.broadcast({
            type: "session_info",
            messageCount: 0,
            tokenUsage,
            history: [],
            contextSize: {
              estimatedTokens: sizeInfo.estimatedTokens,
              bytes: sizeInfo.bytes,
            },
          });

          // Send minimal system message
          this.broadcast({
            type: "system",
            content: "Session cleared",
            level: "success",
          });
          return;
        }

        if (message.type === "git.status") {
          await this.runGitStatus();
          return;
        }

        if (message.type === "git.diff") {
          await this.runGitDiff();
          return;
        }

        if (message.type === "task") {
          const taskContent = message.content;

          if (this.agent.isRunning()) {
            sendToClient({
              type: "system",
              content: "Task already in progress",
              level: "error",
            });
            return;
          }

          log(`📝 New task: ${taskContent}`);

          // Add user message
          this.globalSession.addMessage({
            role: "user",
            content: taskContent,
          });

          this.broadcast({ type: "user_message", content: taskContent });

          // Execute agent (non-blocking)
          this.agent.execute(async (shouldStop) => {
            const history = this.globalSession.getMessages();

            for await (const chunk of continueConversation(
              taskContent,
              history,
              this.globalSession,
              shouldStop,
              undefined,
              false
            )) {
              this.handleAgentEvent(chunk);
            }
          }).catch(err => {
            error("Task error:", err);
            this.broadcast({
              type: "system",
              content: `Error: ${err.message}`,
              level: "error",
            });
          });

          return;
        }
      } catch (error) {
        this.broadcast({
          type: "system",
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          level: "error",
        });
      }
    };

    socket.onclose = () => {
      log("Client disconnected");
      this.connectedClients.delete(socket);
      log(`Total connected clients: ${this.connectedClients.size}`);
    };

    socket.onerror = (err) => {
      error("WebSocket error:", err);
      this.connectedClients.delete(socket);
    };
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.connectedClients.size;
  }
}
