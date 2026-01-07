const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const taskInput = document.getElementById("taskInput");
const submitBtn = document.getElementById("submitBtn");
const statusBtn = document.getElementById("statusBtn");
const diffBtn = document.getElementById("diffBtn");
const archiveBtn = document.getElementById("archiveBtn");

let ws;
let isProcessing = false;
let interruptedTask = null;

function showRetryPrompt(task) {
  const retryDiv = document.createElement("div");
  retryDiv.className = "log-entry";
  retryDiv.style.cssText = "background: #3e3e42; padding: 12px; margin: 8px 0; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;";

  const textSpan = document.createElement("span");
  textSpan.textContent = `⚠️  Previous task was interrupted: "${task}"`;
  retryDiv.appendChild(textSpan);

  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = "display: flex; gap: 8px;";

  const retryBtn = document.createElement("button");
  retryBtn.textContent = "Retry";
  retryBtn.style.cssText = "padding: 4px 12px; font-size: 12px;";
  retryBtn.onclick = () => {
    taskInput.value = task;
    retryDiv.remove();
    interruptedTask = null;
    addLog("Retrying interrupted task...", "info");
    submitBtn.click();
  };

  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "Dismiss";
  dismissBtn.className = "secondary";
  dismissBtn.style.cssText = "padding: 4px 12px; font-size: 12px;";
  dismissBtn.onclick = () => {
    retryDiv.remove();
    interruptedTask = null;
  };

  buttonContainer.appendChild(retryBtn);
  buttonContainer.appendChild(dismissBtn);
  retryDiv.appendChild(buttonContainer);

  output.appendChild(retryDiv);
  output.scrollTop = output.scrollHeight;
}

function addLog(content, level = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  entry.textContent = content;
  output.appendChild(entry);
  output.scrollTop = output.scrollHeight;
}

function showDiff(content) {
  const diffView = document.createElement("div");
  diffView.className = "diff-view";

  const lines = content.split("\n");
  lines.forEach(line => {
    const span = document.createElement("span");
    if (line.startsWith("+") && !line.startsWith("+++")) {
      span.className = "added";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      span.className = "removed";
    }
    span.textContent = line + "\n";
    diffView.appendChild(span);
  });

  output.appendChild(diffView);
  output.scrollTop = output.scrollHeight;
}

function setProcessing(processing) {
  isProcessing = processing;
  submitBtn.disabled = processing;
  statusBtn.disabled = processing;
  diffBtn.disabled = processing;
  archiveBtn.disabled = processing;
  taskInput.disabled = processing;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.classList.add("connected");
    // Server will automatically send session info on connect
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected";
    statusEl.classList.remove("connected");
    addLog("Disconnected from server", "error");
    setProcessing(false);

    // Attempt reconnect after 2 seconds
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    addLog("WebSocket error", "error");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);

    switch (message.type) {
      case "session_info":
        console.log(`Session loaded: ${message.messageCount} messages`);

        // Display history
        if (message.history && message.history.length > 0) {
          output.innerHTML = ""; // Clear welcome message
          for (const entry of message.history) {
            if (entry.isTask) {
              addLog(`📋 Previous task: ${entry.content}`, "info");
            }
          }
          addLog("─".repeat(50), "info");
          addLog("Connected to Sense server", "success");
        }

        // Handle interrupted task
        if (message.interruptedTask) {
          interruptedTask = message.interruptedTask;
          showRetryPrompt(message.interruptedTask);
        }
        break;

      case "log":
        addLog(message.content, message.level);
        break;

      case "tool_use":
        addLog(`🔧 ${message.toolName}`, "tool");
        break;

      case "tool_result":
        if (message.isError) {
          addLog(`❌ Tool error: ${message.content.slice(0, 200)}`, "error");
        }
        // Success results are shown via "log" messages
        break;

      case "thinking":
        addLog(`💭 ${message.content}`, "info");
        break;

      case "task_complete":
        setProcessing(false);
        break;
    }
  };
}

submitBtn.onclick = () => {
  const task = taskInput.value.trim();
  if (!task || isProcessing) return;

  addLog(`Task: ${task}`, "info");
  ws.send(JSON.stringify({ type: "task", content: task }));
  taskInput.value = "";
  setProcessing(true);
};

statusBtn.onclick = () => {
  if (isProcessing) return;
  setProcessing(true);
  ws.send(JSON.stringify({ type: "git.status" }));
};

diffBtn.onclick = () => {
  if (isProcessing) return;
  setProcessing(true);
  ws.send(JSON.stringify({ type: "git.diff" }));
};

archiveBtn.onclick = () => {
  if (isProcessing) return;
  if (confirm("Archive current session and start fresh? The current session will be saved to .sense/archives/")) {
    output.innerHTML = "";
    addLog("Archiving session...", "info");
    ws.send(JSON.stringify({ type: "archive_session" }));
  }
};

taskInput.onkeydown = (e) => {
  if (e.key === "Enter") {
    // Allow Shift+Enter for new lines, but submit on just Enter
    if (e.shiftKey) {
      return; // Let the default behavior happen (new line)
    }

    e.preventDefault();
    submitBtn.click();
  }
};

// Auto-reload detection
let lastClientHash = null;
async function checkForClientUpdates() {
  try {
    const response = await fetch("/client/client.js");
    const content = await response.text();
    const hash = simpleHash(content);

    if (lastClientHash === null) {
      lastClientHash = hash;
    } else if (lastClientHash !== hash) {
      addLog("🔄 Client code updated - reloading page in 2 seconds...", "info");
      setTimeout(() => window.location.reload(), 2000);
    }
  } catch (error) {
    // Ignore errors (server might be restarting)
  }
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// Check for updates every 5 seconds
setInterval(checkForClientUpdates, 5000);

// Connect on load
connect();