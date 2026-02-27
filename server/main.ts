import { continueConversation, invalidateAgentCache, handleIncomingMessage } from "./agent.ts";
import { PersistentSession, createTurn } from "./persistent-session.ts";
import { CONFIG } from "./config.ts";
import { log, error } from "./logger.ts";
import { serveStaticFile } from "./file-server.ts";
import { setToolContext, invalidateToolsCache, loadTools, executeTool } from "./tools-loader.ts";
import type { ServerMessage, ToolInfo } from "../shared/messages.ts";
import type { StreamEvent } from "./agent.ts";

const APPS_DIR = "/run/apps";
const APP_SOCK = `${APPS_DIR}/${CONFIG.APP_NAME}.sock`;

const encoder = new TextEncoder();

// --- Session ---

const session = new PersistentSession();
await session.load();
log(`Session loaded: ${session.getTurnCount()} turns`);

// --- SSE Clients ---

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function sseEncode(msg: ServerMessage): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(msg)}\n\n`);
}

function broadcast(msg: ServerMessage): void {
  const data = sseEncode(msg);
  for (const controller of sseClients) {
    try {
      controller.enqueue(data);
    } catch {
      sseClients.delete(controller);
    }
  }
}

// --- Task State ---

let currentTaskId: string | null = null;
let currentThinking = "";
let currentText = "";
let stopRequested = false;
let runningTask: Promise<void> | null = null;

function getTokenUsage() {
  const usage = session.getTokenUsage();
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
  };
}

function handleStreamEvent(event: StreamEvent): void {
  const taskId = currentTaskId || "unknown";
  switch (event.type) {
    case "thinking_delta":
      currentThinking += event.content;
      broadcast({ type: "thinking_delta", taskId, content: event.content });
      break;
    case "text_delta":
      currentText += event.content;
      broadcast({ type: "text_delta", taskId, content: event.content });
      break;
    case "tool_use":
      broadcast({ type: "tool_use", taskId, toolId: event.toolId, toolName: event.toolName, toolInput: event.toolInput });
      break;
    case "tool_result":
      broadcast({ type: "tool_result", taskId, toolId: event.toolId, toolOutput: event.toolOutput, toolError: event.toolError });
      break;
    case "server_tool_start":
      broadcast({ type: "server_tool_start", taskId, toolId: event.toolId, toolName: event.toolName });
      break;
    case "server_tool_result":
      broadcast({ type: "server_tool_result", taskId, toolId: event.toolId, toolName: event.toolName, content: event.content });
      break;
    case "turn_complete": {
      const lastTurn = session.getLastTurn();
      const role = lastTurn?.role === "assistant" ? "user" : "assistant";
      session.addTurn(createTurn(role as "user" | "assistant", event.blocks, taskId));
      broadcast({ type: "turn_complete", taskId });
      currentThinking = "";
      currentText = "";
      break;
    }
    case "token_usage":
      session.addTokenUsage(event.usage);
      broadcast({ type: "token_usage", usage: getTokenUsage() });
      break;
    case "complete":
      broadcast({ type: "task_complete", taskId });
      currentTaskId = null;
      currentThinking = "";
      currentText = "";
      break;
  }
}

async function executeTask(taskFn: () => Promise<void>): Promise<void> {
  if (runningTask) throw new Error("Task already running");
  stopRequested = false;
  try {
    runningTask = taskFn();
    await runningTask;
  } finally {
    runningTask = null;
    stopRequested = false;
  }
}

async function buildSessionInfo(): Promise<ServerMessage> {
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
  return {
    type: "session_info",
    history: session.getTurns(),
    tokenUsage: getTokenUsage(),
    tools: toolInfos,
  };
}

// --- Tool Context ---

setToolContext({
  broadcast,
  session,
  invalidateTools: invalidateToolsCache,
  invalidateAgent: invalidateAgentCache,
});

// --- Auto-resume ---

if (session.needsResume()) {
  log("Incomplete task detected - auto-resuming");

  (async () => {
    try {
      currentTaskId = crypto.randomUUID();
      const resumeTurn = createTurn("user", "[Resuming after server restart]", currentTaskId);
      session.addTurn(resumeTurn);
      broadcast({ type: "task_start", taskId: currentTaskId });

      await executeTask(async () => {
        for await (const event of continueConversation(session.getLLMMessages(), () => stopRequested)) {
          handleStreamEvent(event);
        }
      });
      log("Auto-resume completed");
    } catch (err) {
      error("Auto-resume failed:", err);
    }
  })();
}

// --- TLS ---

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

// --- HTTP Server ---

Deno.serve({ port: CONFIG.PORT, hostname: "::", ...tlsOptions }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/events" && req.method === "GET") {
    let ctrl: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        ctrl = controller;
        sseClients.add(controller);

        controller.enqueue(sseEncode(await buildSessionInfo()));

        if (currentTaskId) {
          if (currentThinking) {
            controller.enqueue(sseEncode({ type: "thinking_delta", taskId: currentTaskId, content: currentThinking }));
          }
          if (currentText) {
            controller.enqueue(sseEncode({ type: "text_delta", taskId: currentTaskId, content: currentText }));
          }
        }
      },
      cancel() {
        sseClients.delete(ctrl);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  if (path === "/api/task" && req.method === "POST") {
    if (runningTask) {
      return Response.json({ error: "Task already in progress" }, { status: 409 });
    }

    const body = await req.json() as { content: string };
    if (!body.content?.trim()) {
      return Response.json({ error: "content is required" }, { status: 400 });
    }

    currentTaskId = crypto.randomUUID();
    session.addTurn(createTurn("user", body.content, currentTaskId));
    broadcast({ type: "task_start", taskId: currentTaskId });


    // Show token budget at task start
    const usage = getTokenUsage();
    if (usage.totalTokens > 0) {
      broadcast({ type: "system", content: `Session tokens: ${usage.totalTokens.toLocaleString()} (in: ${usage.inputTokens.toLocaleString()}, out: ${usage.outputTokens.toLocaleString()})`, level: "info" });
    }
    executeTask(async () => {
      for await (const event of continueConversation(session.getLLMMessages(), () => stopRequested)) {
        handleStreamEvent(event);
      }
    }).catch((err: Error) => {
      error("Task error:", err);
      broadcast({ type: "system", content: `Error: ${err.message}`, level: "error" });
      currentTaskId = null;
    });

    return Response.json({ taskId: currentTaskId });
  }

  if (path === "/api/command" && req.method === "POST") {
    const body = await req.json() as { name: string; args: Record<string, string> };
    if (!body.name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    log(`Command: /${body.name}`);
    const result = await executeTool(body.name, body.args || {});

    const cmdTaskId = crypto.randomUUID();
    broadcast({
      type: "tool_use",
      taskId: cmdTaskId,
      toolId: crypto.randomUUID(),
      toolName: body.name,
      toolInput: body.args || {},
    });
    broadcast({
      type: "tool_result",
      taskId: cmdTaskId,
      toolId: crypto.randomUUID(),
      toolOutput: result.content,
      toolError: result.isError,
    });

    return Response.json({ result: result.content, isError: result.isError });
  }

  if (path === "/api/stop" && req.method === "POST") {
    if (runningTask) {
      stopRequested = true;
      broadcast({ type: "system", content: "Stopping task...", level: "info" });
      return Response.json({ stopped: true });
    }
    return Response.json({ stopped: false, message: "No task running" });
  }

  if (path === "/api/clear" && req.method === "POST") {
    const result = await executeTool("clear", {});
    broadcast({
      type: "system",
      content: result.content,
      level: result.isError ? "error" : "success",
    });
    return Response.json({ result: result.content });
  }

  return await serveStaticFile(url.pathname);
});

// --- App Communication Socket ---

let appCommListener: Deno.Listener | undefined;

async function startAppCommSocket(): Promise<void> {
  try {
    await Deno.mkdir(APPS_DIR, { recursive: true });
  } catch { /* exists */ }

  try {
    await Deno.remove(APP_SOCK);
  } catch { /* doesn't exist */ }

  appCommListener = Deno.listen({ transport: "unix", path: APP_SOCK });

  (async () => {
    for await (const conn of appCommListener!) {
      handleTalkConnection(conn);
    }
  })().catch(() => { /* listener closed */ });

  try { await Deno.chmod(APP_SOCK, 0o770); } catch { /* non-fatal */ }
  log(`App comm socket: ${APP_SOCK}`);
}

const talkEncoder = new TextEncoder();
const talkDecoder = new TextDecoder();

async function handleTalkConnection(conn: Deno.Conn): Promise<void> {
  const buf = new Uint8Array(65536);
  let partial = "";

  try {
    while (true) {
      const n = await conn.read(buf);
      if (n === null) break;

      partial += talkDecoder.decode(buf.subarray(0, n));
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let request: { id: string; method: string; params: Record<string, unknown> };
        try {
          request = JSON.parse(trimmed);
        } catch {
          const resp = JSON.stringify({ id: "?", ok: false, error: "Invalid JSON" }) + "\n";
          await conn.write(talkEncoder.encode(resp));
          continue;
        }

        try {
          let data: unknown;
          if (request.method === "talk.ping") {
            data = { app: CONFIG.APP_NAME };
          } else if (request.method === "talk.message") {
            const content = request.params.content as string;
            const from = request.params.from as string;
            if (!content?.trim()) throw new Error("content is required");
            const response = await handleIncomingMessage(content, from);
            data = { response, from: CONFIG.APP_NAME };
          } else {
            throw new Error(`Unknown method: ${request.method}`);
          }
          const resp = JSON.stringify({ id: request.id, ok: true, data }) + "\n";
          await conn.write(talkEncoder.encode(resp));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const resp = JSON.stringify({ id: request.id, ok: false, error: message }) + "\n";
          await conn.write(talkEncoder.encode(resp));
        }
      }
    }
  } catch { /* connection error */ } finally {
    try { conn.close(); } catch { /* */ }
  }
}

startAppCommSocket().catch((err) => {
  error("Failed to start app comm socket:", err);
});

// --- Shutdown ---

async function shutdown() {
  log("Shutting down gracefully...");
  for (const controller of sseClients) {
    try { controller.close(); } catch { /* already closed */ }
  }
  sseClients.clear();

  if (appCommListener) {
    appCommListener.close();
    try { await Deno.remove(APP_SOCK); } catch { /* already gone */ }
  }

  await session.shutdown();
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

log(`========================================`);
log(`Server started at ${new Date().toISOString()}`);
log(`Running at ${tlsOptions ? "https" : "http"}://localhost:${CONFIG.PORT}`);
log(`App: ${CONFIG.APP_NAME}`);
log(`Use /help to see available commands`);
log(`========================================`);
