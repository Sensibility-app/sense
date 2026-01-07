import { ClientMessage, ServerMessage } from "./protocol.ts";
import { callAgent } from "./agent.ts";
import { executeAction } from "./tools.ts";
import { load } from "jsr:@std/dotenv@^0.225.0";

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

  // Session history - persists for this WebSocket connection
  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  function send(msg: ServerMessage) {
    socket.send(JSON.stringify(msg));
  }

  socket.onmessage = async (event) => {
    try {
      const message: ClientMessage = JSON.parse(event.data);

      if (message.type === "task") {
        send({ type: "log", content: "Processing task...", level: "info" });

        // Call agent with conversation history
        const response = await callAgent(message.content, conversationHistory);

        send({
          type: "log",
          content: `Plan: ${response.thought_summary}`,
          level: "info",
        });

        // Execute actions
        for (const action of response.actions) {
          send({ type: "action", action });

          const result = await executeAction(action);

          send({
            type: "action_result",
            success: result.success,
            data: result.data,
            error: result.error,
          });

          if (!result.success) {
            send({
              type: "log",
              content: `Action failed: ${result.error}`,
              level: "error",
            });
            return;
          }

          if (result.data) {
            send({
              type: "log",
              content: String(result.data),
              level: "info",
            });
          }
        }

        // Store in conversation history
        conversationHistory.push({
          role: "user",
          content: message.content,
        });
        conversationHistory.push({
          role: "assistant",
          content: JSON.stringify(response),
        });

        send({
          type: "task_complete",
          summary: response.final,
        });
        send({
          type: "log",
          content: `✓ ${response.final}`,
          level: "success",
        });
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
