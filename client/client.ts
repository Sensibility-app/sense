import { Renderer } from "./renderer.ts";
import { Connection } from "./connection.ts";
import { isCommand, parseCommand } from "./command-parser.ts";
import type { ServerMessage, Turn, Block, ContentPart } from "../shared/messages.ts";

const $ = (id: string) => document.getElementById(id)!;

const renderer = new Renderer($("output"), $("submitBtn"), $("stopBtn"));
const connection = new Connection($("taskForm"));
const taskInput = $("taskInput") as HTMLTextAreaElement;
let lastHistoryHash = "";

connection.onMessage = handleMessage;

$("taskForm").addEventListener("submit", (e) => {
  e.preventDefault();
  submitTask();
});

$("taskInput").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter" && !(e as KeyboardEvent).shiftKey) {
    e.preventDefault();
    submitTask();
  }
});

$("taskInput").addEventListener("input", () => {
  autoGrowTextarea(taskInput);
  updateMainPadding();
});

function autoGrowTextarea(textarea: HTMLTextAreaElement): void {
  // Reset height to calculate scrollHeight correctly
  textarea.style.height = "0";
  // Get the computed border height
  const computed = getComputedStyle(textarea);
  const borderHeight = parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);
  // Set to scrollHeight plus border
  textarea.style.height = (textarea.scrollHeight + borderHeight) + "px";
}

function updateMainPadding(): void {
  const form = $("taskForm") as HTMLFormElement;
  const main = $("output") as HTMLElement;
  const formHeight = form.offsetHeight;
  main.style.paddingBottom = `${formHeight + 16}px`;
}

// Initialize textarea height on page load
autoGrowTextarea(taskInput);
updateMainPadding();

$("stopBtn").addEventListener("click", () => connection.stopTask());

window.addEventListener("beforeunload", () => connection.disconnect());

connection.connect();

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case "session_info": {
      const hash = hashHistory(message.history);
      if (hash !== lastHistoryHash) {
        renderHistory(message.history);
        lastHistoryHash = hash;
      }
      renderer.restoreScrollPosition();
      break;
    }

    case "task_start":
      renderer.setProcessing(true);
      break;

    case "thinking_delta":
      renderer.addBlock({ type: "thinking", content: message.content });
      break;

    case "text_delta":
      renderer.addBlock({ type: "text", content: message.content });
      break;

    case "tool_use":
      renderer.addBlock({ type: "tool_use", id: message.toolId, name: message.toolName, input: message.toolInput });
      break;

    case "tool_result":
      renderer.addBlock({ type: "tool_result", tool_use_id: message.toolId, content: message.toolOutput, is_error: message.toolError });
      break;

    case "task_complete":
      renderer.finishTask();
      break;

    case "system":
      renderer.addBlock({ type: "system", content: message.content, level: message.level });
      break;

    case "reload_page":
      renderer.saveScrollPosition();
      setTimeout(() => window.location.reload(), 100);
      break;
  }
}

function renderHistory(turns: Turn[]): void {
  renderer.clear();
  const toolResults = collectToolResults(turns);

  for (const turn of turns) {
    if (turn.role === "user" && typeof turn.content === "string") {
      renderer.addBlock({ type: "user", content: turn.content });
    } else if (turn.role === "assistant" && Array.isArray(turn.content)) {
      for (const block of turn.content) {
        renderHistoryBlock(block, toolResults);
      }
    }
  }
}

function collectToolResults(turns: Turn[]): Map<string, { content: string | ContentPart[]; is_error: boolean }> {
  const results = new Map<string, { content: string | ContentPart[]; is_error: boolean }>();
  for (const turn of turns) {
    if (turn.role === "user" && Array.isArray(turn.content)) {
      for (const block of turn.content) {
        if (block.type === "tool_result") {
          results.set(block.tool_use_id, { content: block.content, is_error: block.is_error });
        }
      }
    }
  }
  return results;
}

function renderHistoryBlock(block: Block, toolResults: Map<string, { content: string | ContentPart[]; is_error: boolean }>): void {
  switch (block.type) {
    case "thinking":
      renderer.addBlock({ type: "thinking", content: block.thinking });
      break;
    case "text":
      renderer.addBlock({ type: "text", content: block.text });
      break;
    case "tool_use": {
      renderer.addBlock({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      const result = toolResults.get(block.id);
      if (result) {
        renderer.addBlock({ type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.is_error });
      }
      break;
    }
  }
}

function hashHistory(turns: Turn[]): string {
  let hash = turns.length.toString();
  for (const turn of turns) {
    hash += turn.id;
  }
  return hash;
}

async function submitTask(): Promise<void> {
  const task = taskInput.value.trim();
  if (!task) return;

  if (!connection.isConnected()) {
    renderer.addBlock({ type: "system", content: "Not connected", level: "error" });
    return;
  }

  if (isCommand(task)) {
    const parsed = parseCommand(task);
    if (parsed && await connection.sendCommand(parsed.name, parsed.args)) {
      taskInput.value = "";
      autoGrowTextarea(taskInput);
    }
  } else {
    renderer.addBlock({ type: "user", content: task });
    if (await connection.sendTask(task)) {
      taskInput.value = "";
      autoGrowTextarea(taskInput);
    }
  }
}
