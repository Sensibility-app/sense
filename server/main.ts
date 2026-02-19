import { continueConversation, invalidateClaudeCache } from "./claude.ts";
import { PersistentSession, createTurn } from "./persistent-session.ts";
import { CONFIG } from "./config.ts";
import { log, error } from "./logger.ts";
import { serveStaticFile } from "./file-server.ts";
import { WebSocketHandler } from "./websocket-handler.ts";
import { setToolContext, invalidateToolsCache } from "./tools-loader.ts";

const session = new PersistentSession();
await session.load();
log(`Session loaded: ${session.getTurnCount()} turns`);

const wsHandler = new WebSocketHandler(session);

setToolContext({
  broadcast: wsHandler.broadcast.bind(wsHandler),
  session,
  invalidateTools: invalidateToolsCache,
  invalidateClaude: invalidateClaudeCache,
});

if (session.needsResume()) {
  log("Incomplete task detected - auto-resuming");

  (async () => {
    try {
      const resumeTaskId = crypto.randomUUID();
      const resumeTurn = createTurn("user", "[Resuming after server restart]", resumeTaskId);
      session.addTurn(resumeTurn);
      
      await wsHandler.execute(async (shouldStop: () => boolean) => {
        for await (const event of continueConversation(session.getClaudeMessages(), shouldStop)) {
          wsHandler.handleStreamEvent(event);
        }
      });
      log("Auto-resume completed");
    } catch (err) {
      error("Auto-resume failed:", err);
    }
  })();
}

const certFile = "/certs/cert.pem";
const keyFile = "/certs/key.pem";

let tlsOptions: { cert: string; key: string } | undefined;
try {
  tlsOptions = {
    cert: await Deno.readTextFile(certFile),
    key: await Deno.readTextFile(keyFile),
  };
  log("TLS certificates loaded");
} catch {
  log("No TLS certificates found, running HTTP only");
}

Deno.serve({ port: CONFIG.PORT, hostname: "::", ...tlsOptions }, async (req) => {
  const url = new URL(req.url);

  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    wsHandler.handleConnection(socket);
    return response;
  }

  return await serveStaticFile(url.pathname);
});

async function shutdown() {
  log("Shutting down gracefully...");
  wsHandler.shutdown();
  await session.shutdown();
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

log(`========================================`);
log(`Server started at ${new Date().toISOString()}`);
log(`Running at ${tlsOptions ? "https" : "http"}://localhost:${CONFIG.PORT}`);
log(`Use /help to see available commands`);
log(`========================================`);
