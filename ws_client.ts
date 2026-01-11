/**
 * WebSocket Test Client
 *
 * Simple CLI tool for testing Sense WebSocket API directly.
 *
 * Usage:
 *   deno run --allow-net ws_client.ts "your message here"
 *   deno run --allow-net ws_client.ts --clear "your message"
 */

const WS_URL = "ws://localhost:8080";

// Parse command line arguments
const args = Deno.args;
const shouldClear = args.includes("--clear");
const message = args.filter(arg => !arg.startsWith("--")).join(" ");

if (!message) {
  console.error("Usage: deno run --allow-net ws_client.ts [--clear] <message>");
  Deno.exit(1);
}

// Connect to WebSocket
const ws = new WebSocket(WS_URL);
let turnCount = 0;

ws.onopen = () => {
  console.log("🔗 Connected to Sense");

  if (shouldClear) {
    console.log("🗑️  Clearing session...");
    ws.send(JSON.stringify({ type: "clear_session" }));
    setTimeout(() => {
      ws.send(JSON.stringify({ type: "task", content: message }));
    }, 500);
  } else {
    ws.send(JSON.stringify({ type: "task", content: message }));
  }
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "thinking":
      // Show thinking indicator without overwhelming output
      Deno.stdout.writeSync(new TextEncoder().encode("💭"));
      break;

    case "text_delta":
      // Stream response text
      Deno.stdout.writeSync(new TextEncoder().encode(msg.content));
      break;

    case "system":
      if (msg.level === "error") {
        console.error("\n❌ ERROR:", msg.content);
        ws.close();
      } else if (msg.level === "success") {
        console.log("\n✅", msg.content);
      } else {
        console.log("\nℹ️ ", msg.content);
      }
      break;

    case "task_complete":
      console.log("\n\n✓ Task complete");
      ws.close();
      break;

    case "token_usage":
      // Optional: show token usage
      if (msg.formatted) {
        console.log(`\n📊 Tokens: ${msg.formatted}`);
      }
      break;

    // Ignore connection housekeeping messages
    case "ping":
    case "session_info":
    case "processing_status":
      break;

    default:
      // Log unknown message types for debugging
      console.log(`\n[${msg.type}]`, msg);
  }
};

ws.onerror = (error) => {
  console.error("❌ WebSocket error:", error);
  Deno.exit(1);
};

ws.onclose = () => {
  console.log("👋 Disconnected");
  Deno.exit(0);
};

// Timeout after 60 seconds
setTimeout(() => {
  console.error("\n⏱️  Timeout after 60 seconds");
  ws.close();
  Deno.exit(1);
}, 60000);
