import { load } from "jsr:@std/dotenv@^0.225.0";
import { executeTaskWithClaude } from "./claude.ts";
import { SessionLogger } from "./session.ts";
import { PersistentSession, archiveCurrentSession } from "./persistent-session.ts";

// Load .env file
await load({ export: true });

// Global session (shared across all clients)
const globalSession = new PersistentSession();
await globalSession.load();

type ClientMessage =
  | { type: "task"; content: string }
  | { type: "archive_session" };

type ServerMessage =
  | { type: "session_info"; messageCount: number; interruptedTask?: string; history: Array<{role: string; content: string; isTask?: boolean}> }
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

  const sessionLogger = new SessionLogger();

  function send(msg: ServerMessage) {
    socket.send(JSON.stringify(msg));
  }

  // Send session info immediately on connect
  const interruptedTask = globalSession.getInterruptedTask();
  const messages = globalSession.getMessages();

  // Build history for client display
  const history: Array<{role: string; content: string; isTask?: boolean}> = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      history.push({
        role: "user",
        content: msg.content as string,
        isTask: true,
      });
    } else if (msg.role === "assistant") {
      // Skip assistant messages for now (they're tool use JSON)
      // We'll just show user tasks
    }
  }

  send({
    type: "session_info",
    messageCount: messages.length,
    ...(interruptedTask && { interruptedTask }),
    history,
  });

  if (interruptedTask) {
    send({
      type: "log",
      content: `⚠️  Found interrupted task: "${interruptedTask}"`,
      level: "info",
    });
  }

  socket.onmessage = async (event) => {
    try {
      const message: ClientMessage = JSON.parse(event.data);

      if (message.type === "archive_session") {
        await archiveCurrentSession();
        await globalSession.clear();
        send({
          type: "log",
          content: `✨ Session archived. Starting fresh!`,
          level: "success",
        });
        send({
          type: "session_info",
          messageCount: 0,
          history: [],
        });
        return;
      }

      if (message.type === "task") {
        const startTime = Date.now();
        send({ type: "log", content: "🤖 Claude is working on your task...", level: "info" });

        try {
          // Mark task as started
          globalSession.startTask(message.content);

          // Add user message to persistent session
          globalSession.addMessage({
            role: "user",
            content: message.content,
          });

          // Execute task with Claude using tool use
          let taskComplete = false;
          const conversationHistory = globalSession.getMessages();
          for await (const chunk of executeTaskWithClaude(message.content, conversationHistory)) {
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

          // Mark task as complete
          globalSession.completeTask();

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

          // Mark task as failed
          globalSession.failTask();

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
