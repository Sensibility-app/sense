import { load } from "jsr:@std/dotenv@^0.225.0";
import { continueConversation } from "./claude.ts";
import { PersistentSession, archiveCurrentSession, formatSessionHistory, getLastUserMessage, type DisplayMessage } from "./persistent-session.ts";
import { log, error } from "./logger.ts";
import { setTranspileCallback } from "./transpile.ts";
import { type ClientMessage, type ServerMessage, formatTokenUsage } from "./server-types.ts";
import { serveStaticFile } from "./file-server.ts";
// === Agent execution context ===
type BroadcastFn = (message: any) => void;

/**
 * Agent execution context - manages task lifecycle and stop requests
 */
class AgentContext {
  private stopRequested = false;
  private runningTask: Promise<void> | null = null;
  private pendingReload = false;
  private broadcastFn: BroadcastFn | null = null;

  /**
   * Set broadcast function for sending messages to clients
   */
  setBroadcast(broadcast: BroadcastFn): void {
    this.broadcastFn = broadcast;
  }

  /**
   * Check if agent is currently running
   */
  isRunning(): boolean {
    return this.runningTask !== null;
  }

  /**
   * Request agent to stop gracefully
   */
  requestStop(): void {
    this.stopRequested = true;
    log("🛑 Stop requested");
  }

  /**
   * Check if stop was requested
   */
  shouldStop(): boolean {
    return this.stopRequested;
  }

  /**
   * Request a page reload (will be deferred if task is running)
   */
  requestReload(): void {
    if (this.isRunning()) {
      log("⏸️  Deferring page reload until task completes");
      this.pendingReload = true;
    } else {
      this.triggerReload();
    }
  }

  /**
   * Trigger immediate page reload
   */
  private triggerReload(): void {
    if (this.broadcastFn) {
      log("🔄 Triggering page reload");
      this.broadcastFn({ type: "reload_page", reason: "Server code changed" });
    }
    this.pendingReload = false;
  }

  /**
   * Execute an agent task with automatic lifecycle management
   */
  async execute(
    taskFn: (shouldStop: () => boolean) => Promise<void>
  ): Promise<void> {
    if (this.runningTask) {
      throw new Error("Agent already running");
    }

    this.stopRequested = false;

    try {
      if (this.broadcastFn) {
        this.broadcastFn({ type: "processing_status", isProcessing: true });
      }

      this.runningTask = taskFn(() => this.shouldStop());
      await this.runningTask;
    } finally {
      this.runningTask = null;
      this.stopRequested = false;

      if (this.broadcastFn) {
        this.broadcastFn({ type: "processing_status", isProcessing: false });
      }

      // Trigger pending reload if needed (after task completes)
      if (this.pendingReload) {
        log("🔄 Triggering deferred reload");
        setTimeout(() => this.triggerReload(), 100);
      }
    }
  }
}

// Load .env file
await load({ export: true });

// Global session (shared across all clients)
const globalSession = new PersistentSession();
await globalSession.load();
log(`📂 Session loaded: ${globalSession.getMessages().length} messages`);

// Track all connected clients for broadcasting
const connectedClients = new Set<WebSocket>();

// Agent execution context
const agent = new AgentContext();

// Helper function to execute git commands
async function executeGitCommand(
  args: string[],
  processingMessage: string,
  completeSummary: string,
  broadcast: (message: ServerMessage) => void,
  customHandler?: (code: number, output: string, errorOutput: string) => void
): Promise<void> {
  try {
    broadcast({
      type: "processing_status",
      isProcessing: true,
      message: processingMessage
    });

    const cmd = new Deno.Command("git", {
      args,
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    // Use custom handler if provided, otherwise use default
    if (customHandler) {
      customHandler(code, output, errorOutput);
    } else {
      broadcast({
        type: "assistant_response",
        content: code === 0 ? output : errorOutput,
      });
    }

    broadcast({
      type: "processing_status",
      isProcessing: false
    });

    broadcast({
      type: "task_complete",
      summary: completeSummary,
    });
  } catch (error) {
    broadcast({
      type: "system",
      content: `Git error: ${error instanceof Error ? error.message : String(error)}`,
      level: "error",
    });

    broadcast({
      type: "processing_status",
      isProcessing: false
    });
  }
}

// AUTO-RESUME: Check if incomplete task exists and auto-resume on server startup
if (globalSession.needsResume()) {
  log("🔄 Incomplete task detected - auto-resuming");

  // Start in background, don't block server startup
  (async () => {
    try {
      await agent.execute(async (shouldStop) => {
        // Validate and clean conversation history before resuming
        // This fixes any unpaired tool_use/tool_result blocks from interruptions
        log("🔍 Validating conversation history...");
        await globalSession.validateAndCleanHistory();

        // Add resume notification
        globalSession.addMessage({
          role: "user",
          content: "[Resuming after server restart]"
        });

        // Continue with full conversation history
        const history = globalSession.getMessages();

        for await (const chunk of continueConversation(
          "",
          history,
          globalSession,
          shouldStop,
          undefined,
          true // resumeMode
        )) {
          // Broadcast events to clients
          handleAgentEvent(chunk);
        }
      });
      log("✅ Auto-resume completed");
    } catch (err) {
      error("❌ Auto-resume failed:", err);
    }
  })();
}

const PORT = 8080;

// File watcher for hot reload
let fileWatcher: Deno.FsWatcher | null = null;

// Setup transpile callback for client reload
setTranspileCallback((filepath: string, fromCache: boolean) => {
  // Only reload on fresh transpilation, not cache hits
  if (!fromCache) {
    const filename = filepath.split('/').pop();
    log(`🔄 Fresh transpilation complete: ${filename}`);

    // Don't reload if a task is currently running (would interrupt it)
    if (agent.isRunning()) {
      log(`⏸️  Deferring reload - task is running`);
      broadcast({
        type: "system",
        content: `${filename} compiled - page will reload after task completes`,
        level: "info"
      });
      agent.requestReload();
    } else {
      // Small delay to ensure response is sent before reload
      setTimeout(() => {
        broadcast({
          type: "reload_page",
          reason: `TypeScript compiled: ${filename}`
        });
      }, 50);
    }
  }
});

// Setup file watcher for client files
function setupFileWatcher() {
  try {
    fileWatcher = Deno.watchFs("./client");

    (async () => {
      if (!fileWatcher) return;

      for await (const event of fileWatcher) {
        if (event.kind === "modify") {
          const changedPath = event.paths[0];
          const changedFile = changedPath.split('/').pop();

          // TypeScript files: transpile first, then reload via callback
          if (changedPath.endsWith('.ts')) {
            log(`📝 TypeScript file changed: ${changedFile}, triggering transpilation`);

            try {
              // Trigger proactive transpilation
              // The transpile callback will handle broadcasting reload
              await transpileFile(changedPath);
            } catch (err) {
              error(`❌ Transpilation failed for ${changedFile}:`, err);

              // Broadcast error to clients (don't reload on error!)
              broadcast({
                type: "system",
                content: `TypeScript error in ${changedFile}: ${err instanceof Error ? err.message : String(err)}`,
                level: "error"
              });
            }
          }
          // Non-TypeScript files: reload only if no task is running
          else if (changedPath.endsWith('.css') ||
                   changedPath.endsWith('.html') ||
                   changedPath.endsWith('.js')) {
            log(`📝 Client file changed: ${changedFile}`);

            // Don't reload if a task is currently running (would interrupt it)
            if (agent.isRunning()) {
              log(`⏸️  Deferring reload - task is running`);
              broadcast({
                type: "system",
                content: `${changedFile} updated - page will reload after task completes`,
                level: "info"
              });
              agent.requestReload();
            } else {
              log(`Broadcasting reload`);
              // Small delay to ensure file is fully written to disk
              setTimeout(() => {
                broadcast({
                  type: "reload_page",
                  reason: `Client file updated: ${changedFile}`
                });
              }, 100);
            }
          }
        }
      }
    })().catch(err => {
      error("File watcher error:", err);
    });

    log("👁️  File watcher enabled for ./client directory");
  } catch (err) {
    error("Failed to setup file watcher:", err);
  }
}

// Cleanup function
function cleanup() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  setTranspileCallback(null);
}

// Broadcast to all connected clients
function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        error("Failed to send to client:", err);
      }
    }
  }
}

// Setup agent broadcast function
agent.setBroadcast(broadcast);

// Handle agent events and broadcast to clients
function handleAgentEvent(chunk: any): void {
  if (chunk.type === "text_delta") {
    broadcast({ type: "text_delta", content: chunk.content });
  } else if (chunk.type === "tool_use") {
    broadcast({
      type: "tool_use",
      toolName: chunk.toolName!,
      toolId: chunk.toolId!,
      toolInput: chunk.toolInput,
    });
  } else if (chunk.type === "tool_result") {
    broadcast({
      type: "tool_result",
      toolId: chunk.toolId || crypto.randomUUID(),
      content: chunk.content,
      isError: chunk.isError || false,
    });
  } else if (chunk.type === "token_usage" && chunk.tokenUsage) {
    globalSession.addTokenUsage(chunk.tokenUsage);
    const totalUsage = globalSession.getTokenUsage();
    broadcast({
      type: "token_usage",
      usage: totalUsage,
      formatted: formatTokenUsage(totalUsage),
    });
  } else if (chunk.type === "complete") {
    broadcast({
      type: "task_complete",
      summary: "Task completed"
    });
  }
}

// Handle slash commands
function handleSlashCommand(command: string): { handled: boolean; type?: string } {
  const trimmedCommand = command.trim().toLowerCase();
  
  if (trimmedCommand === "/clear") {
    return { handled: true, type: "clear_session" };
  }
  
  return { handled: false };
}

// Handle WebSocket connections
function handleWebSocket(socket: WebSocket) {
  log("Client connected");

  // Add to connected clients
  connectedClients.add(socket);
  log(`Total connected clients: ${connectedClients.size}`);

  // Helper to send to just this client (for session_info on connect)
  function sendToClient(msg: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(msg));
      } catch (err) {
        error("Failed to send to client:", err);
      }
    }
  }

  // Function to send initial session info
  function sendSessionInfo() {
    const messages = globalSession.getMessages();
    const tokenUsage = globalSession.getTokenUsage();
    const sizeInfo = globalSession.getSessionSizeInfo();
    const history = formatSessionHistory(messages);

    sendToClient({
      type: "session_info",
      messageCount: messages.length,
      tokenUsage,
      history,
      isTaskRunning: agent.isRunning(), // Tell client if agent is currently active
      contextSize: {
        estimatedTokens: sizeInfo.estimatedTokens,
        bytes: sizeInfo.bytes,
      },
    });
  }

  // Send session info immediately if socket is already OPEN, otherwise wait for onopen event
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
        if (agent.isRunning()) {
          agent.requestStop();
          broadcast({
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
        await globalSession.clear();

        const tokenUsage = globalSession.getTokenUsage();
        const sizeInfo = globalSession.getSessionSizeInfo();

        // Send state update
        broadcast({
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
        broadcast({
          type: "system",
          content: "Session cleared",
          level: "success",
        });
        return;
      }

      if (message.type === "git.status") {
        await executeGitCommand(
          ["status"],
          "Running git status...",
          "Git status complete",
          broadcast
        );
        return;
      }

      if (message.type === "git.diff") {
        await executeGitCommand(
          ["diff"],
          "Running git diff...",
          "Git diff complete",
          broadcast,
          (code, output, errorOutput) => {
            if (code === 0 && output) {
              broadcast({
                type: "assistant_response",
                content: output,
              });
            } else if (code === 0 && !output) {
              broadcast({
                type: "system",
                content: "No changes to show",
                level: "info",
              });
            } else {
              broadcast({
                type: "system",
                content: `Git diff error: ${errorOutput}`,
                level: "error",
              });
            }
          }
        );
        return;
      }

      if (message.type === "task") {
        // Check if this is a slash command
        const slashCommand = handleSlashCommand(message.content);
        if (slashCommand.handled) {
          // Handle the slash command by converting it to the appropriate message type
          const commandMessage = { type: slashCommand.type, content: message.content };
          // Recursively handle the converted command
          socket.onmessage?.({ data: JSON.stringify(commandMessage) } as MessageEvent);
          return;
        }

        const taskContent = message.content;

        if (agent.isRunning()) {
          sendToClient({
            type: "system",
            content: "Task already in progress",
            level: "error",
          });
          return;
        }

        log(`📝 New task: ${taskContent}`);

        // Add user message
        globalSession.addMessage({
          role: "user",
          content: taskContent,
        });

        broadcast({ type: "user_message", content: taskContent });

        // Execute agent (non-blocking)
        agent.execute(async (shouldStop) => {
          const history = globalSession.getMessages();

          for await (const chunk of continueConversation(
            taskContent,
            history,
            globalSession,
            shouldStop,
            undefined,
            false
          )) {
            handleAgentEvent(chunk);
          }
        }).catch(err => {
          error("Task error:", err);
          broadcast({
            type: "system",
            content: `Error: ${err.message}`,
            level: "error",
          });
        });

        return;
      }
    } catch (error) {
      broadcast({
        type: "system",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
    }
  };

  socket.onclose = () => {
    log("Client disconnected");
    connectedClients.delete(socket);
    log(`Total connected clients: ${connectedClients.size}`);
  };

  socket.onerror = (err) => {
    error("WebSocket error:", err);
    connectedClients.delete(socket);
  };
}

// HTTP server
Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);

  // Upgrade WebSocket connections
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket);
    return response;
  }

  // Serve static files (handles transpilation automatically)
  return serveStaticFile(url.pathname, (filepath, fromCache) => {
    if (!fromCache) {
      agent.requestReload();
    }
  });
});

// Setup file watcher for hot reload
setupFileWatcher();

// Cleanup on shutdown signals
Deno.addSignalListener("SIGINT", () => {
  log("Received SIGINT, cleaning up...");
  cleanup();
  Deno.exit(0);
});

Deno.addSignalListener("SIGTERM", () => {
  log("Received SIGTERM, cleaning up...");
  cleanup();
  Deno.exit(0);
});

const startupTime = new Date().toISOString();
log(`========================================`);
log(`Server (re)started at ${startupTime}`);
log(`Running at http://localhost:${PORT}`);
log(`Started with: deno task ${Deno.env.get("DENO_TASK_NAME") || "start"}`);
log(`Server logs: .sense/server.log`);
log(`Hot reload enabled for client files`);
log(`========================================`);