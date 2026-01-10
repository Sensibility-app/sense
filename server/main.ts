import { load } from "jsr:@std/dotenv@^0.225.0";
import { continueConversation } from "./claude.ts";
import { PersistentSession, archiveCurrentSession, formatSessionHistory, getLastUserMessage, type DisplayMessage } from "./persistent-session.ts";
import { log, error } from "./logger.ts";
import { setTranspileCallback } from "./transpile.ts";
import { type ClientMessage, type ServerMessage, formatTokenUsage } from "./server-types.ts";
import { serveStaticFile } from "./file-server.ts";
import { ReloadManager } from "./reload-manager.ts";
import { AgentContext, type BroadcastFn } from "./agent-context.ts";
import { setupFileWatcher } from "./file-watcher.ts";

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

// Reload manager for coordinating page reloads
const reloadManager = new ReloadManager();

// Git status command
async function runGitStatus(broadcast: BroadcastFn): Promise<void> {
  broadcast({ type: "processing_status", isProcessing: true, message: "Running git status..." });

  try {
    const cmd = new Deno.Command("git", { args: ["status"], cwd: Deno.cwd(), stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    broadcast({ type: "assistant_response", content: code === 0 ? output : errorOutput });
    broadcast({ type: "task_complete", summary: "Git status complete" });
  } catch (error) {
    broadcast({ type: "system", content: `Git error: ${error instanceof Error ? error.message : String(error)}`, level: "error" });
  } finally {
    broadcast({ type: "processing_status", isProcessing: false });
  }
}

// Git diff command
async function runGitDiff(broadcast: BroadcastFn): Promise<void> {
  broadcast({ type: "processing_status", isProcessing: true, message: "Running git diff..." });

  try {
    const cmd = new Deno.Command("git", { args: ["diff"], cwd: Deno.cwd(), stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    if (code === 0 && output) {
      broadcast({ type: "assistant_response", content: output });
    } else if (code === 0 && !output) {
      broadcast({ type: "system", content: "No changes to show", level: "info" });
    } else {
      broadcast({ type: "system", content: `Git diff error: ${errorOutput}`, level: "error" });
    }

    broadcast({ type: "task_complete", summary: "Git diff complete" });
  } catch (error) {
    broadcast({ type: "system", content: `Git error: ${error instanceof Error ? error.message : String(error)}`, level: "error" });
  } finally {
    broadcast({ type: "processing_status", isProcessing: false });
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

// File watcher (initialized later)
let fileWatcher: Deno.FsWatcher | null = null;

// Setup transpile callback for client reload
setTranspileCallback((filepath: string, fromCache: boolean) => {
  // Only reload on fresh transpilation, not cache hits
  if (!fromCache) {
    const filename = filepath.split('/').pop();
    log(`🔄 Fresh transpilation complete: ${filename}`);
    reloadManager.requestReload(`TypeScript compiled: ${filename}`);
  }
});

// Cleanup function
function cleanup() {
  if (fileWatcher) {
    fileWatcher.close();
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

// Setup reload manager and wire to agent
reloadManager.setBroadcast(broadcast);
agent.setReloadManager(reloadManager);

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
        await runGitStatus(broadcast);
        return;
      }

      if (message.type === "git.diff") {
        await runGitDiff(broadcast);
        return;
      }

      if (message.type === "task") {
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
      const filename = filepath.split('/').pop() || filepath;
      reloadManager.requestReload(`File transpiled: ${filename}`);
    }
  });
});

// Setup file watcher for hot reload
fileWatcher = setupFileWatcher(reloadManager, broadcast);

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