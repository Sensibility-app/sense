import { load } from "jsr:@std/dotenv@^0.225.0";
import { executeTaskWithClaude } from "./claude.ts";
import { SessionLogger } from "./session.ts";
import { PersistentSession, archiveCurrentSession } from "./persistent-session.ts";
import { formatSessionHistory, getLastUserMessage, type DisplayMessage } from "./session-formatter.ts";
import { log, error } from "./logger.ts";
import { tokenTracker } from "./token-tracker.ts";
import { getTranspiledClient } from "./transpile.ts";

// Load .env file
await load({ export: true });

// Global session (shared across all clients)
const globalSession = new PersistentSession();
await globalSession.load();

// Track server startup time for reconnection detection
const serverStartTime = Date.now();

// Track all connected clients for broadcasting
const connectedClients = new Set<WebSocket>();

// Track active tasks to ensure completion even if client disconnects
const activeTasks = new Map<string, {
  taskId: string;
  stopRequested: boolean;
  startTime: number;
  sessionLogger: any;
  content: string;
}>();

type ClientMessage =
  | { type: "task"; content: string }
  | { type: "stop_task" }
  | { type: "archive_session" }
  | { type: "clear_session" }
  | { type: "git.status" }
  | { type: "git.diff" }
  | { type: "ping" };

type ServerMessage =
  // State updates (header only)
  | { type: "session_info"; messageCount: number; interruptedTask?: string; history: DisplayMessage[]; tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }; contextSize?: { estimatedTokens: number; bytes: number } }
  | { type: "connection_status"; status: "connected" | "disconnected"; message?: string }
  | { type: "processing_status"; isProcessing: boolean; message?: string }
  | { type: "token_usage"; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; formatted: string }

  // Conversation messages (chat display)
  | { type: "user_message"; content: string }
  | { type: "assistant_response"; content?: string; streaming?: boolean }
  | { type: "text_delta"; content: string }
  | { type: "thinking"; content: string }

  // Tool use messages
  | { type: "tool_use"; toolName: string; toolId: string; toolInput?: unknown }
  | { type: "tool_result"; toolId: string; content: string; isError: boolean }

  // System messages (small, minimal in chat)
  | { type: "system"; content: string; level?: "info" | "error" | "success" }
  | { type: "tool_activity"; toolName: string; status: "started" | "completed" | "error"; preview?: string; toolId?: string }
  
  // Task lifecycle
  | { type: "task_complete"; summary: string }
  
  // Heartbeat
  | { type: "pong" };

const PORT = 8080;

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

// Handle slash commands
function handleSlashCommand(command: string): { handled: boolean; type?: string } {
  const trimmedCommand = command.trim().toLowerCase();
  
  if (trimmedCommand === "/clear") {
    return { handled: true, type: "clear_session" };
  }
  
  return { handled: false };
}

// Complete task and clean up, regardless of client connection status
async function completeTaskSafely(taskId: string, success: boolean, errorMsg?: string) {
  const taskInfo = activeTasks.get(taskId);
  if (!taskInfo) return;

  try {
    if (success) {
      globalSession.completeTask();
      
      await taskInfo.sessionLogger.logTask(
        taskInfo.content,
        { completed: true },
        true,
        taskInfo.startTime,
      );
      
      log(`Task completed successfully: ${taskInfo.content.slice(0, 50)}...`);
    } else {
      globalSession.failTask();
      
      await taskInfo.sessionLogger.logTask(
        taskInfo.content,
        null,
        false,
        taskInfo.startTime,
        errorMsg,
      );
      
      log(`Task failed: ${taskInfo.content.slice(0, 50)}... Error: ${errorMsg}`);
    }
  } catch (err) {
    error("Error completing task safely:", err);
  } finally {
    activeTasks.delete(taskId);
  }
}

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
      : ext === "json"
      ? "application/json"
      : ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "svg"
      ? "image/svg+xml"
      : ext === "ico"
      ? "image/x-icon"
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
  log("Client connected");

  // Add to connected clients
  connectedClients.add(socket);
  log(`Total connected clients: ${connectedClients.size}`);

  const sessionLogger = new SessionLogger();

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
    const interruptedTask = globalSession.getInterruptedTask();
    const messages = globalSession.getMessages();
    const tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const sizeInfo = globalSession.getSessionSizeInfo();

    // Check if there's currently an active task running
    const hasActiveTask = activeTasks.size > 0;

    // Format conversation history for display
    const history = formatSessionHistory(messages);

    sendToClient({
      type: "session_info",
      messageCount: messages.length,
      tokenUsage,
      history,
      contextSize: {
        estimatedTokens: sizeInfo.estimatedTokens,
        bytes: sizeInfo.bytes,
      },
      // Only show interrupted task if there's no active task currently running
      ...(!hasActiveTask && interruptedTask && { interruptedTask }),
    });

    // Only send reconnection messages if we have an existing session
    if (messages.length > 0) {
      // Check if this connection is happening soon after server start (likely server restart)
      const timeSinceServerStart = Date.now() - serverStartTime;
      const isLikelyServerRestart = timeSinceServerStart < 10000; // Within 10 seconds of server start
      
      // Check if there was a task interrupted by server restart
      const task = globalSession.getCurrentTask();
      const wasTaskInterruptedByRestart = !hasActiveTask && interruptedTask && task && task.interruptionReason === "server_restart";
      
      // connectedClients.size includes this current connection, so check for <= 1 for first client
      if (isLikelyServerRestart && connectedClients.size <= 1) {
        // Server restart - show single consolidated message
          if (wasTaskInterruptedByRestart) {
             // Task was interrupted by server restart - store and send system message
             globalSession.addMessage({
               role: "system",
               content: "Server restarted during task"
             });
             
             sendToClient({
               type: "system",
               content: `Type "continue" to resume interrupted task`,
               level: "info",
             });
         } else {
           // Server restart without interrupted task
           globalSession.addMessage({
             role: "system",
             content: "Server restarted"
           });
           
           sendToClient({
             type: "system",
             content: "Server restarted",
             level: "info",
           });
         }
       } else {
         // Client reconnection (not server restart)
         globalSession.addMessage({
           role: "system", 
           content: "Client reconnected"
         });
         
         sendToClient({
           type: "system",
           content: "Client reconnected", 
           level: "info",
         });
        
        sendToClient({
          type: "system",
          content: "Client reconnected", 
          level: "info",
        });
        
        // If there's an interrupted task, provide continue instruction
        if (!hasActiveTask && interruptedTask) {
          sendToClient({
            type: "system",
            content: `Type "continue" to resume interrupted task`,
            level: "info",
          });
        }
      }
    } else {
      // Empty session - send welcome message from server
      sendToClient({
        type: "system",
        content: "Ready",
        level: "info",
      });
    }
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
        // Stop any currently running task
        for (const [taskId, taskInfo] of activeTasks.entries()) {
          taskInfo.stopRequested = true;
          log(`Stop requested for task: ${taskId}`);
        }
        broadcast({
          type: "system",
          content: "Stopping task...",
          level: "info",
        });
        return;
      }

      if (message.type === "archive_session" || message.type === "clear_session") {
        await archiveCurrentSession();
        await globalSession.clear();
        tokenTracker.reset(); // Reset the token tracker when session is cleared

        const tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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
        try {
          broadcast({
            type: "processing_status",
            isProcessing: true,
            message: "Running git status..."
          });

          const cmd = new Deno.Command("git", {
            args: ["status"],
            cwd: Deno.cwd(),
            stdout: "piped",
            stderr: "piped",
          });
          const { code, stdout, stderr } = await cmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);

          // Show git output as assistant response
          broadcast({
            type: "assistant_response",
            content: code === 0 ? output : errorOutput,
          });

          broadcast({
            type: "processing_status",
            isProcessing: false
          });
          
          broadcast({
            type: "task_complete",
            summary: "Git status complete",
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
        return;
      }

      if (message.type === "git.diff") {
        try {
          broadcast({
            type: "processing_status",
            isProcessing: true,
            message: "Running git diff..."
          });

          const cmd = new Deno.Command("git", {
            args: ["diff"],
            cwd: Deno.cwd(),
            stdout: "piped",
            stderr: "piped",
          });
          const { code, stdout, stderr } = await cmd.output();
          const output = new TextDecoder().decode(stdout);
          const errorOutput = new TextDecoder().decode(stderr);

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
          
          broadcast({
            type: "processing_status",
            isProcessing: false
          });
          
          broadcast({
            type: "task_complete",
            summary: "Git diff complete",
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

        // Check if user wants to continue an interrupted task
        const isContinueRequest = message.content.trim().toLowerCase() === "continue";
        const interruptedTask = globalSession.getInterruptedTask();
        const currentTaskInfo = globalSession.getCurrentTask();

        let taskMessage = message.content;
        if (isContinueRequest && interruptedTask && currentTaskInfo?.canResume) {
          // Transform "continue" into a context-aware continuation request
          const reasonText = currentTaskInfo.interruptionReason === "max_iterations"
            ? `You reached the iteration limit (${currentTaskInfo.iterationCount}/25) while working on this`
            : currentTaskInfo.interruptionReason === "server_restart"
            ? "The server restarted while you were working on this"
            : "The task was interrupted";

          taskMessage = `Continue the interrupted task: "${interruptedTask}". ${reasonText}. Please continue from where you left off.`;

          log(`Continuing interrupted task: ${interruptedTask}`);

          // Clear the interrupted status since we're resuming
          globalSession.clearCurrentTask();
        }

        const startTime = Date.now();
        const taskId = `task_${startTime}_${Math.random().toString(36).substr(2, 9)}`;

        log(`Starting task: ${taskMessage}`);

        // Track this task
        activeTasks.set(taskId, {
          taskId,
          stopRequested: false,
          startTime,
          sessionLogger,
          content: taskMessage
        });
        
        // Send user message to chat (show original if "continue", otherwise show taskMessage)
        broadcast({
          type: "user_message",
          content: isContinueRequest && interruptedTask ? `continue` : taskMessage
        });

        // Update processing status (header)
        broadcast({
          type: "processing_status",
          isProcessing: true,
          message: "Claude is thinking..."
        });

        // Run task asynchronously to ensure completion even if client disconnects
        (async () => {
          try {
            // Mark task as started (use taskMessage which has full context)
            globalSession.startTask(taskMessage);

            // Add user message to persistent session (use taskMessage for full context)
            globalSession.addMessage({
              role: "user",
              content: taskMessage,
            });

            // Execute task with Claude using tool use
            let taskComplete = false;
            let taskStopped = false;
            const conversationHistory = globalSession.getMessages();
            let currentTextMessage = ""; // Accumulate text chunks
            let hasStartedAssistantMessage = false;
            let currentToolId: string | null = null;

            // Create a stop check function
            const shouldStop = () => {
              const taskInfo = activeTasks.get(taskId);
              return taskInfo?.stopRequested || false;
            };

            let finalMessages: any[] = [];

            for await (const chunk of executeTaskWithClaude(taskMessage, conversationHistory, globalSession, shouldStop, undefined)) {
              if (chunk.type === "text_delta") {
                // Start assistant message on first text delta
                if (!hasStartedAssistantMessage) {
                  broadcast({ type: "assistant_response" });
                  hasStartedAssistantMessage = true;
                }
                // Stream text as it arrives
                currentTextMessage += chunk.content;
                broadcast({ type: "text_delta", content: chunk.content });
              } else if (chunk.type === "text") {
                // Final text response
                if (!hasStartedAssistantMessage) {
                  broadcast({ type: "assistant_response" });
                  hasStartedAssistantMessage = true;
                }
                broadcast({ type: "text_delta", content: chunk.content });
              } else if (chunk.type === "tool_use") {
                hasStartedAssistantMessage = false; // Reset for next message
                currentToolId = crypto.randomUUID();
                broadcast({
                  type: "tool_use",
                  toolName: chunk.toolName!,
                  toolId: currentToolId,
                  toolInput: chunk.toolInput
                });
              } else if (chunk.type === "tool_result") {
                broadcast({
                  type: "tool_result",
                  toolId: currentToolId || crypto.randomUUID(),
                  content: chunk.content,
                  isError: chunk.isError || false
                });
                currentToolId = null;
              } else if (chunk.type === "token_usage") {
                // Broadcast token usage to all clients (including cache metrics)
                if (chunk.tokenUsage) {
                  const usage = chunk.tokenUsage;
                  let formatted = `${usage.totalTokens.toLocaleString()} tokens (${usage.inputTokens.toLocaleString()} in, ${usage.outputTokens.toLocaleString()} out)`;

                  // Add cache information if available
                  if (usage.cacheCreationInputTokens && usage.cacheCreationInputTokens > 0) {
                    formatted += ` | 📝 Cache created: ${usage.cacheCreationInputTokens.toLocaleString()}`;
                  }
                  if (usage.cacheReadInputTokens && usage.cacheReadInputTokens > 0) {
                    formatted += ` | ⚡ Cache hit: ${usage.cacheReadInputTokens.toLocaleString()}`;
                  }

                  broadcast({
                    type: "token_usage",
                    usage: {
                      inputTokens: usage.inputTokens,
                      outputTokens: usage.outputTokens,
                      totalTokens: usage.totalTokens,
                    },
                    formatted
                  });
                }
              } else if ((chunk as any).type === "conversation_history") {
                // Capture the full conversation history
                finalMessages = (chunk as any).conversationHistory || [];
              } else if (chunk.type === "complete") {
                taskComplete = true;
                if (chunk.content === "Task stopped by user") {
                  taskStopped = true;
                }
              }
            }

            // Final safety check: save any remaining messages
            // NOTE: Messages are now saved incrementally in claude.ts after each tool call
            // This is just a fallback to catch any edge cases
            if (finalMessages.length > conversationHistory.length) {
              // Add any new messages that weren't saved incrementally
              const newMessages = finalMessages.slice(conversationHistory.length);
              if (newMessages.length > 0) {
                for (const msg of newMessages) {
                  globalSession.addMessage(msg);
                }
                await globalSession.save();
                log(`Saved ${newMessages.length} additional messages to session`);
              }
            } else if (currentTextMessage.trim() && finalMessages.length === 0) {
              // Edge case: text response but no finalMessages captured
              globalSession.addMessage({
                role: "assistant",
                content: [{ type: "text", text: currentTextMessage }],
              });
              await globalSession.save();
            }

            // Complete task (successfully or stopped)
            await completeTaskSafely(taskId, !taskStopped);

            // Update processing status
            broadcast({
              type: "processing_status",
              isProcessing: false
            });

            if (taskStopped) {
              broadcast({
                type: "task_complete",
                summary: "Task stopped by user",
              });

              broadcast({
                type: "system",
                content: "Task stopped",
                level: "info",
              });
            } else {
              broadcast({
                type: "task_complete",
                summary: "Task completed successfully",
              });

              // Minimal system message for session logging
              const sessionFile = sessionLogger.getSessionFile().split("/").pop();
              broadcast({
                type: "system",
                content: `Logged to ${sessionFile}`,
                level: "info",
              });
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Complete task with error
            await completeTaskSafely(taskId, false, errorMsg);

            // Update processing status
            broadcast({
              type: "processing_status",
              isProcessing: false
            });

            broadcast({
              type: "system",
              content: `Error: ${errorMsg}`,
              level: "error",
            });
          }
        })();
        
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

  // Intercept /client/client.js to serve transpiled TypeScript
  if (url.pathname === "/client/client.js") {
    try {
      const result = await getTranspiledClient();

      if (result.error) {
        error("⚠️  TypeScript transpilation error:", result.error);
        error("📦 Serving last known good version");
      }

      return new Response(result.code, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate", // Always fresh in dev
          "X-Transpiled": "true", // Debug header
        },
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error("❌ Failed to transpile client.ts:", errorMessage);

      return new Response(
        `// TypeScript transpilation failed\n// Error: ${errorMessage}\nconsole.error("Failed to load client code:", ${JSON.stringify(errorMessage)});`,
        {
          status: 500,
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
          },
        },
      );
    }
  }

  // Serve static files
  const path = url.pathname === "/" ? "/client/index.html" : url.pathname;
  return serveFile(`.${path}`);
});

const startupTime = new Date().toISOString();
log(`========================================`);
log(`Server (re)started at ${startupTime}`);
log(`Running at http://localhost:${PORT}`);
log(`Started with: deno task ${Deno.env.get("DENO_TASK_NAME") || "start"}`);
log(`Server logs: .sense/server.log`);
log(`========================================`);