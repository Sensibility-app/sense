import { log, error } from "./logger.ts";
import { continueConversation, type StreamEvent } from "./claude.ts";
import { type PersistentSession, createTurn } from "./persistent-session.ts";
import type { ClientMessage, ServerMessage, TokenUsage, ToolInfo, Block } from "../shared/messages.ts";
import { CONFIG } from "./config.ts";
import { executeTool, loadTools } from "./tools-loader.ts";

function getTokenUsage(session: PersistentSession): TokenUsage {
  const usage = session.getTokenUsage();
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

interface ClientConnection {
  socket: WebSocket;
  clientId: string;
  lastClientPing: number;
}

export class WebSocketHandler {
  private connectedClients = new Map<WebSocket, ClientConnection>();
  private cleanupInterval?: number;
  private stopRequested = false;
  private runningTask: Promise<void> | null = null;
  private currentTaskId: string | null = null;
  private currentThinking = "";
  private currentText = "";

  constructor(private globalSession: PersistentSession) {
    this.startCleanupInterval();
  }

  isRunning(): boolean {
    return this.runningTask !== null;
  }

  requestStop(): void {
    this.stopRequested = true;
    log("Stop requested");
  }

  private shouldStop(): boolean {
    return this.stopRequested;
  }

  async execute(taskFn: (shouldStop: () => boolean) => Promise<void>): Promise<void> {
    if (this.runningTask) {
      throw new Error("Agent already running");
    }
    this.stopRequested = false;
    try {
      this.runningTask = taskFn(() => this.shouldStop());
      await this.runningTask;
    } finally {
      this.runningTask = null;
      this.stopRequested = false;
    }
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, CONFIG.WEBSOCKET_PING_INTERVAL_MS);
  }

  private cleanupDeadConnections(): void {
    const now = Date.now();
    for (const [socket, conn] of this.connectedClients) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.removeClient(socket);
        continue;
      }

      const timeSinceLastPing = now - conn.lastClientPing;
      if (timeSinceLastPing > CONFIG.WEBSOCKET_PONG_TIMEOUT_MS * 2) {
        log(`Client ${conn.clientId} timed out, closing`);
        socket.close();
        this.removeClient(socket);
      }
    }
  }

  private removeClient(socket: WebSocket): void {
    this.connectedClients.delete(socket);
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const [socket] of this.connectedClients) {
      socket.close();
    }
    this.connectedClients.clear();
  }

  broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const [socket] of this.connectedClients) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(payload);
        } catch (err) {
          error("Failed to send to client:", err);
        }
      }
    }
  }

  handleStreamEvent(event: StreamEvent): void {
    const taskId = this.currentTaskId || "unknown";
    
    switch (event.type) {
      case "thinking_delta":
        this.currentThinking += event.content;
        this.broadcast({ type: "thinking_delta", taskId, content: event.content });
        break;
      case "text_delta":
        this.currentText += event.content;
        this.broadcast({ type: "text_delta", taskId, content: event.content });
        break;
      case "tool_use":
        this.broadcast({ type: "tool_use", taskId, toolId: event.toolId, toolName: event.toolName, toolInput: event.toolInput });
        break;
      case "tool_result":
        this.broadcast({ type: "tool_result", taskId, toolId: event.toolId, toolOutput: event.toolOutput, toolError: event.toolError });
        break;
      case "turn_complete":
        const lastTurn = this.globalSession.getLastTurn();
        const role = lastTurn?.role === "assistant" ? "user" : "assistant";
        this.globalSession.addTurn(createTurn(role as "user" | "assistant", event.blocks, taskId));
        this.broadcast({ type: "turn_complete", taskId });
        // Clear accumulated content after turn completes
        this.currentThinking = "";
        this.currentText = "";
        break;
      case "token_usage":
        this.globalSession.addTokenUsage(event.usage);
        this.broadcast({ type: "token_usage", usage: getTokenUsage(this.globalSession) });
        break;
      case "complete":
        this.broadcast({ type: "task_complete", taskId });
        this.currentTaskId = null;
        this.currentThinking = "";
        this.currentText = "";
        break;
    }
  }

  handleConnection(socket: WebSocket): boolean {
    if (this.connectedClients.size >= CONFIG.MAX_WEBSOCKET_CONNECTIONS) {
      log(`Connection rejected: max connections (${CONFIG.MAX_WEBSOCKET_CONNECTIONS}) reached`);
      socket.close(1013, "Max connections reached");
      return false;
    }

    const clientId = Math.random().toString(36).substring(2, 8);
    log(`Client ${clientId} connected (${this.connectedClients.size + 1}/${CONFIG.MAX_WEBSOCKET_CONNECTIONS})`);

    const conn: ClientConnection = {
      socket,
      clientId,
      lastClientPing: Date.now(),
    };

    this.connectedClients.set(socket, conn);

    const sendToClient = (msg: ServerMessage) => {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify(msg));
        } catch (err) {
          error(`Failed to send to client ${clientId}:`, err);
        }
      }
    };

    const sendSessionInfo = async () => {
      const tools = await loadTools();
      const toolInfos: ToolInfo[] = tools.map(t => ({
        name: t.definition.name,
        description: t.definition.description,
        parameters: Object.entries(t.definition.input_schema.properties || {}).map(([name, prop]) => ({
          name,
          type: (prop as { type: string }).type,
          description: (prop as { description: string }).description,
          required: t.definition.input_schema.required?.includes(name) ?? false,
        })),
      }));

      sendToClient({
        type: "session_info",
        history: this.globalSession.getTurns(),
        tokenUsage: getTokenUsage(this.globalSession),
        tools: toolInfos,
      });

      // If there's a task in progress, send the accumulated content
      if (this.currentTaskId) {
        if (this.currentThinking) {
          sendToClient({
            type: "thinking_delta",
            taskId: this.currentTaskId,
            content: this.currentThinking,
          });
        }
        if (this.currentText) {
          sendToClient({
            type: "text_delta",
            taskId: this.currentTaskId,
            content: this.currentText,
          });
        }
      }
    };

    setTimeout(() => sendSessionInfo(), CONFIG.SESSION_INFO_DELAY_MS);

    socket.onmessage = async (event) => {
      try {
        const message: ClientMessage = JSON.parse(event.data);

        if (message.type === "ping") {
          conn.lastClientPing = Date.now();
          sendToClient({ type: "pong" });
          return;
        }

        if (message.type === "stop_task") {
          if (this.isRunning()) {
            this.requestStop();
            this.broadcast({ type: "system", content: "Stopping task...", level: "info" });
          } else {
            sendToClient({ type: "system", content: "No task running", level: "info" });
          }
          return;
        }

        if (message.type === "clear_session") {
          const result = await executeTool("clear", {});
          this.broadcast({ 
            type: "system", 
            content: result.content, 
            level: result.isError ? "error" : "success" 
          });
          return;
        }

        if (message.type === "command") {
          log(`Command: /${message.name}`);
          const result = await executeTool(message.name, message.args);
          const cmdTaskId = crypto.randomUUID();
          
          this.broadcast({
            type: "tool_use",
            taskId: cmdTaskId,
            toolId: crypto.randomUUID(),
            toolName: message.name,
            toolInput: message.args,
          });
          this.broadcast({
            type: "tool_result",
            taskId: cmdTaskId,
            toolId: crypto.randomUUID(),
            toolOutput: result.content,
            toolError: result.isError,
          });
          return;
        }

        if (message.type === "task") {
          if (this.isRunning()) {
            sendToClient({ type: "system", content: "Task already in progress", level: "error" });
            return;
          }

          log(`New task: ${message.content}`);
          
          this.currentTaskId = crypto.randomUUID();
          
          const userTurn = createTurn("user", message.content, this.currentTaskId);
          this.globalSession.addTurn(userTurn);
          
          this.broadcast({ type: "task_start", taskId: this.currentTaskId });

          this.execute(async (shouldStop) => {
            const claudeMessages = this.globalSession.getClaudeMessages();
            for await (const event of continueConversation(claudeMessages, shouldStop)) {
              this.handleStreamEvent(event);
            }
          }).catch((err: Error) => {
            error("Task error:", err);
            this.broadcast({ type: "system", content: `Error: ${err.message}`, level: "error" });
            this.currentTaskId = null;
          });
        }
      } catch (err) {
        this.broadcast({
          type: "system",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          level: "error",
        });
      }
    };

    socket.onclose = () => {
      log(`Client ${clientId} disconnected`);
      this.removeClient(socket);
    };

    socket.onerror = () => {
      this.removeClient(socket);
    };

    return true;
  }

  getClientCount(): number {
    return this.connectedClients.size;
  }
}
