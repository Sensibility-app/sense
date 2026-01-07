import { load } from "jsr:@std/dotenv@^0.225.0";
import { executeTaskWithClaude } from "./claude.ts";
import { SessionLogger } from "./session.ts";

// Load .env file
await load({ export: true });

type ClientMessage =
  | { type: "task"; content: string }
  | { type: "git.status" }
  | { type: "git.diff" };

type ServerMessage =
  | { type: "log"; content: string; level: "info" | "error" | "success" | "tool" }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; toolName: string; input: unknown }
  | { type: "tool_result"; content: string; isError: boolean }
  | { type: "task_complete"; summary: string };

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
        send({ type: "log", content: "🤖 Claude is working on your task...", level: "info" });

        try {
          // Execute task with Claude using tool use
          let taskComplete = false;
          for await (const chunk of executeTaskWithClaude(message.content)) {
            if (chunk.type === "text") {
              send({ type: "log", content: chunk.content, level: "info" });
            } else if (chunk.type === "tool_use") {
              send({
                type: "tool_use",
                toolName: chunk.toolName!,
                input: chunk.toolInput,
              });
              send({
                type: "log",
                content: `🔧 ${chunk.content}`,
                level: "tool",
              });
            } else if (chunk.type === "tool_result") {
              send({
                type: "tool_result",
                content: chunk.content,
                isError: chunk.isError || false,
              });
              const resultPreview = chunk.content.slice(0, 200) + (chunk.content.length > 200 ? "..." : "");
              send({
                type: "log",
                content: chunk.isError ? `❌ ${resultPreview}` : `✓ ${resultPreview}`,
                level: chunk.isError ? "error" : "success",
              });
            } else if (chunk.type === "complete") {
              taskComplete = true;
            }
          }

          // Log to session
          await sessionLogger.logTask(
            message.content,
            { completed: taskComplete },
            taskComplete,
            startTime,
          );

          send({
            type: "task_complete",
            summary: "Task completed successfully",
          });
          send({
            type: "log",
            content: `📝 Session logged to ${sessionLogger.getSessionFile().split("/").pop()}`,
            level: "info",
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          send({
            type: "log",
            content: `Error: ${errorMsg}`,
            level: "error",
          });

          await sessionLogger.logTask(
            message.content,
            null,
            false,
            startTime,
            errorMsg,
          );
        }
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
