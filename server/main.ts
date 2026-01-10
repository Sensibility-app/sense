import { load } from "jsr:@std/dotenv@^0.225.0";
import { continueConversation } from "./claude.ts";
import { PersistentSession, formatSessionHistory, getLastUserMessage, type DisplayMessage } from "./persistent-session.ts";
import { log, error } from "./logger.ts";
import { setTranspileCallback } from "./transpile.ts";
import { serveStaticFile } from "./file-server.ts";
import { ReloadManager } from "./reload-manager.ts";
import { AgentContext } from "./agent-context.ts";
import { setupFileWatcher } from "./file-watcher.ts";
import { WebSocketHandler } from "./websocket-handler.ts";

// Load .env file
await load({ export: true });

// Global session (shared across all clients)
const globalSession = new PersistentSession();
await globalSession.load();
log(`Session loaded: ${globalSession.getMessages().length} messages`);

// Agent execution context
const agent = new AgentContext();

// Reload manager for coordinating page reloads
const reloadManager = new ReloadManager();

// WebSocket handler
const wsHandler = new WebSocketHandler(globalSession, agent);

// AUTO-RESUME: Check if incomplete task exists and auto-resume on server startup
if (globalSession.needsResume()) {
  log("Incomplete task detected - auto-resuming");

  // Start in background, don't block server startup
  (async () => {
    try {
      await agent.execute(async (shouldStop) => {
        // Validate and clean conversation history before resuming
        // This fixes any unpaired tool_use/tool_result blocks from interruptions
        log("Validating conversation history...");
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
          wsHandler.handleAgentEvent(chunk);
        }
      });
      log("Auto-resume completed");
    } catch (err) {
      error("Auto-resume failed:", err);
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
    log(`Fresh transpilation complete: ${filename}`);
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

// Setup agent and reload manager with WebSocket broadcast
agent.setBroadcast(wsHandler.broadcast.bind(wsHandler));
reloadManager.setBroadcast(wsHandler.broadcast.bind(wsHandler));
agent.setReloadManager(reloadManager);

// HTTP server - bind to all interfaces (0.0.0.0) for network access
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);

  // Upgrade WebSocket connections
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    wsHandler.handleConnection(socket);
    return response;
  }

  // Serve static files (handles transpilation automatically)
  const response = await serveStaticFile(url.pathname, (filepath, fromCache) => {
    if (!fromCache) {
      const filename = filepath.split('/').pop() || filepath;
      reloadManager.requestReload(`File transpiled: ${filename}`);
    }
  });

  return response;
});

// Setup file watcher for hot reload
fileWatcher = setupFileWatcher(reloadManager, wsHandler.broadcast.bind(wsHandler));

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