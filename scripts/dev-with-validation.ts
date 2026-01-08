/**
 * Development server with validation-on-reload
 *
 * Watches for file changes and validates TypeScript syntax before restarting.
 * If validation fails, keeps the current working server running.
 */

let serverProcess: Deno.ChildProcess | null = null;
let isRestarting = false;

function startServer() {
  console.log("🚀 Starting server...");
  return new Deno.Command("deno", {
    args: ["run", "--allow-all", "server/main.ts"],
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

async function validateSyntax(): Promise<boolean> {
  const check = await new Deno.Command("deno", {
    args: ["check", "server/main.ts"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (check.code !== 0) {
    const error = new TextDecoder().decode(check.stderr);
    console.error("❌ Syntax validation failed:");
    console.error(error);
    return false;
  }

  return true;
}

async function restartServer() {
  if (isRestarting) return;
  isRestarting = true;

  console.log("\n📝 Files changed, validating syntax...");

  const isValid = await validateSyntax();

  if (isValid) {
    console.log("✅ Syntax valid! Restarting server...\n");

    if (serverProcess) {
      try {
        serverProcess.kill("SIGTERM");
        await serverProcess.status;
      } catch {
        // Process already dead
      }
    }

    serverProcess = startServer();
  } else {
    console.error("❌ Syntax errors detected. Keeping current server running.");
    console.error("💡 Fix the errors above and save again.\n");
  }

  isRestarting = false;
}

// Start initial server
console.log("🔍 Development server with syntax validation");
console.log("📂 Watching: ./server, ./client\n");

serverProcess = startServer();

// Watch for file changes
const watcher = Deno.watchFs(["./server", "./client"]);

// Debounce rapid file changes
let debounceTimer: number | null = null;

for await (const event of watcher) {
  // Ignore .swp, .tmp, and other editor temp files
  const paths = event.paths.filter(p =>
    !p.endsWith(".swp") &&
    !p.endsWith(".tmp") &&
    !p.includes("/.git/") &&
    !p.includes("~")
  );

  if (paths.length === 0) continue;

  // Only restart on modify or create events
  if (event.kind === "modify" || event.kind === "create") {
    // Debounce: wait 100ms for more changes
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      restartServer();
      debounceTimer = null;
    }, 100);
  }
}
