#!/usr/bin/env -S deno run --allow-net

/**
 * WebSocket Test Client for Sense
 *
 * Usage:
 *   deno run --allow-net scripts/ws-test.ts [--clear] ["task description"]
 *
 * Options:
 *   --clear, -c    Clear the session before running the test
 *
 * Examples:
 *   deno run --allow-net scripts/ws-test.ts
 *   deno run --allow-net scripts/ws-test.ts --clear
 *   deno run --allow-net scripts/ws-test.ts "List files in server directory"
 *   deno run --allow-net scripts/ws-test.ts --clear "Read client/index.html"
 */

const WS_URL = "ws://localhost:8080";

// Parse command line arguments
const args = Deno.args;
const shouldClear = args.includes("--clear") || args.includes("-c");
const taskArg = args.find(arg => !arg.startsWith("-"));
const testTask = taskArg || "Show me the first 20 lines of server/tools-mcp.ts";

// Show help if requested
if (args.includes("--help") || args.includes("-h")) {
  console.log(`WebSocket Test Client for Sense

Usage:
  deno run --allow-net scripts/ws-test.ts [--clear] ["task description"]

Options:
  --clear, -c    Clear the session before running the test
  --help, -h     Show this help message

Examples:
  deno run --allow-net scripts/ws-test.ts
  deno run --allow-net scripts/ws-test.ts --clear
  deno run --allow-net scripts/ws-test.ts "List files in server directory"
  deno run --allow-net scripts/ws-test.ts --clear "Read client/index.html"
`);
  Deno.exit(0);
}

console.log(`Connecting to ${WS_URL}...`);
if (shouldClear) {
  console.log("Will clear session before running test\n");
}

const ws = new WebSocket(WS_URL);

let sessionCleared = false;
let initialSessionInfo = false;
let taskSent = false;

// Helper function to send the test task
function sendTestTask() {
  if (taskSent) return;
  taskSent = true;

  setTimeout(() => {
    console.log(`📤 Sending test task: "${testTask}"\n`);
    ws.send(JSON.stringify({
      type: "task",
      content: testTask
    }));
  }, 500); // Small delay to ensure session_info is fully processed
}

ws.onopen = () => {
  console.log("✓ Connected to Sense server\n");

  // Wait for initial session_info before proceeding
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);

    // Color-code different message types
    if (msg.type === "session_info") {
      console.log(`📊 SESSION_INFO: ${msg.messageCount} messages, ${msg.history?.length || 0} history items`);

      // Handle initial connection
      if (!initialSessionInfo) {
        initialSessionInfo = true;

        if (shouldClear && !sessionCleared) {
          // Clear the session
          console.log("🧹 Clearing session...\n");
          ws.send(JSON.stringify({ type: "clear_session" }));
          sessionCleared = true;
        } else {
          // No clear needed, send test task
          sendTestTask();
        }
      } else if (sessionCleared && msg.messageCount === 0) {
        // Session was cleared successfully
        console.log("✓ Session cleared\n");
        sendTestTask();
      }
    } else if (msg.type === "user_message") {
      console.log(`👤 USER: ${msg.content}`);
    } else if (msg.type === "assistant_response") {
      console.log(`🤖 ASSISTANT START`);
    } else if (msg.type === "text_delta") {
      process.stdout.write(msg.content);
    } else if (msg.type === "tool_use") {
      console.log(`\n\n🔧 TOOL USE: ${msg.toolName}`);
      console.log(`   Tool ID: ${msg.toolId}`);
      console.log(`   Input params:`, JSON.stringify(msg.toolInput, null, 2));
    } else if (msg.type === "tool_result") {
      console.log(`\n✅ TOOL RESULT (${msg.toolId}):`);
      console.log(`   Error: ${msg.isError || false}`);
      console.log(`   Content preview: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}`);
    } else if (msg.type === "system") {
      console.log(`\n💬 SYSTEM [${msg.level}]: ${msg.content}`);
    } else if (msg.type === "task_complete") {
      console.log(`\n\n✓ TASK COMPLETE: ${msg.summary}\n`);

      // Give it a moment, then exit
      setTimeout(() => {
        console.log("Closing connection...");
        ws.close();
      }, 500);
    } else if (msg.type === "processing_status") {
      console.log(`⚙️  Processing: ${msg.isProcessing ? 'YES' : 'NO'} - ${msg.message || ''}`);
    } else {
      console.log(`📨 ${msg.type}:`, JSON.stringify(msg, null, 2));
    }
  } catch (err) {
    console.error("Failed to parse message:", event.data);
  }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket error:", error);
};

ws.onclose = () => {
  console.log("Connection closed");
  Deno.exit(0);
};

// Auto-exit after 30 seconds
setTimeout(() => {
  console.log("\n⏰ Timeout - closing connection");
  ws.close();
}, 30000);
