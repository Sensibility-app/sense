const output = document.getElementById("output");
const statusEl = document.getElementById("status");
const taskInput = document.getElementById("taskInput");
const submitBtn = document.getElementById("submitBtn");
const statusBtn = document.getElementById("statusBtn");
const diffBtn = document.getElementById("diffBtn");

let ws;
let isProcessing = false;

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
  taskInput.disabled = processing;
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.classList.add("connected");
    addLog("Connected to Sense server", "success");
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
      case "log":
        addLog(message.content, message.level);
        break;

      case "action":
        const action = message.action;
        addLog(`→ ${action.type}`, "action");
        break;

      case "action_result":
        if (!message.success && message.error) {
          addLog(`✗ ${message.error}`, "error");
        }
        break;

      case "diff":
        if (message.content) {
          showDiff(message.content);
        } else {
          addLog("No changes", "info");
        }
        setProcessing(false);
        break;

      case "status":
        if (message.content) {
          addLog(message.content, "info");
        } else {
          addLog("Working tree clean", "info");
        }
        setProcessing(false);
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

taskInput.onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitBtn.click();
  }
};

// Connect on load
connect();
