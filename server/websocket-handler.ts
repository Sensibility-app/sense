/**
 * WebSocket handler
 * Manages WebSocket connections, message routing, and client broadcasting
 */

import { log, error } from "./logger.ts";
import { continueConversation } from "./claude.ts";
import { archiveCurrentSession, formatSessionHistory, type PersistentSession } from "./persistent-session.ts";
import { type ClientMessage, type ServerMessage, formatTokenUsage } from "./server-types.ts";
import type { AgentContext, BroadcastFn } from "./agent-context.ts";
import { formatToolAsMarkdown } from "./tools/_shared/tool-formatter.ts";

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
    } else if (chunk.type === "tool_complete") {
      // Format tool execution as markdown and broadcast as text_delta
      const markdown = formatToolAsMarkdown({
        toolName: chunk.toolName!,
        toolId: chunk.toolId!,
        toolInput: chunk.toolInput,
        toolResult: chunk.content,
        isError: chunk.isError || false,
      });
      this.broadcast({
        type: "text_delta",
        content: "\n\n" + markdown + "\n\n",
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
   * Handle new WebSocket connection
   */
  handleConnection(socket: WebSocket): void {
    // Generate client ID for tracking
    const clientId = Math.random().toString(36).substring(2, 8);
    log(`Client ${clientId} connected`);

    // Add to connected clients
    this.connectedClients.add(socket);

    // Helper to send to just this client
    const sendToClient = (msg: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(msg));
        } catch (err) {
          error(`Failed to send to client ${clientId}:`, err);
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

    // Send session info when socket opens
    if (socket.readyState === WebSocket.OPEN) {
      sendToClient({ type: "ping" as any });
      setTimeout(() => sendSessionInfo(), 100);
    } else {
      socket.onopen = () => {
        sendToClient({ type: "ping" as any });
        setTimeout(() => sendSessionInfo(), 100);
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

          log(`New task: ${taskContent}`);

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

    socket.onclose = (event) => {
      log(`Client ${clientId} disconnected (${event.code})`);
      this.connectedClients.delete(socket);
    };

    socket.onerror = (err) => {
      error(`Client ${clientId} error:`, err);
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
