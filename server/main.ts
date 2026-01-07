import { ClientMessage, ServerMessage } from "./protocol.ts";
import { executeAction } from "./tools.ts";
import { load } from "jsr:@std/dotenv@^0.225.0";
import { executeTaskAgentically } from "./executor.ts";
import { SessionLogger } from "./session.ts";

// Load .env file
await load({ export: true });

const PORT = 8080;

// Serve static files from client directory
async function serveFile(path: string): Promise<Response> {
  try {
    const file = await Deno.readFile(path);
    const ext = path.split(".").pop();
    const contentType = ext === "html"
      ? "text/html"
      : ext === "js"
      ? "text/javascript"
      : ext === "css"
      ? "text/css"
      : "text/plain";

    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// Handle WebSocket connections
function handleWebSocket(socket: WebSocket) {
  console.log("Client connected");

  // Create session logger for this connection
  const sessionLogger = new SessionLogger();

  function send(msg: ServerMessage) {
    socket.send(JSON.stringify(msg));
  }

  socket.onmessage = async (event) => {
    try {
      const message: ClientMessage = JSON.parse(event.data);

      if (message.type === "task") {
        const startTime = Date.now();
        send({ type: "log", content: "Starting agentic task execution...", "level": "info" });

        // Execute task agentically with retries
        const result = await executeTaskAgentically(
          message.content,
          (msg, level) => send({ type: "log", content: msg, level }),
        );

        // Log to session
        await sessionLogger.logTask(
          message.content,
          result.finalResponse,
          result.success,
          startTime,
          result.error,
        );

        if (result.success) {
          send({
            type: "task_complete",
            summary: result.finalResponse?.final || "Task completed",
          });
          send({
            type: "log",
            content: `Session logged to ${sessionLogger.getSessionFile()}`,
            level: "info",
          });
        } else {
          send({
            type: "log",
            content: `Task failed: ${result.error}`,
            level: "error",
          });
        }
      } else if (message.type === "git.status") {
        const result = await executeAction({ type: "git.status" });
        send({
          type: "status",
          content: result.success ? String(result.data) : result.error || "",
        });
      } else if (message.type === "git.diff") {
        const result = await executeAction({ type: "git.diff" });
        send({
          type: "diff",
          content: result.success ? String(result.data) : result.error || "",
        });
      }
    } catch (error) {
      send({
        type: "log",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        level: "error",
      });
    }
  };

  socket.onclose = () => {
    console.log("Client disconnected");
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

// HTTP server
Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);

  // Upgrade WebSocket connections
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket);
    return response;
  }

  // Serve static files
  const path = url.pathname === "/" ? "/client/index.html" : url.pathname;
  return serveFile(`.${path}`);
});

console.log(`Server running at http://localhost:${PORT}`);
console.log("Make sure ANTHROPIC_API_KEY is set in your environment");
