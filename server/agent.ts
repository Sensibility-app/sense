import Anthropic from "@anthropic-ai/sdk";
import { AgentResponse, validateAgentResponse } from "./protocol.ts";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not found in environment");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

const SYSTEM_PROMPT = `You are an execution agent for a development environment. You DO NOT chat or explain - you ONLY output executable JSON.

RESPONSE FORMAT (you must use this EXACT structure):
{
  "thought_summary": "Brief plan",
  "actions": [
    {"type": "fs.writeFile", "path": "file.txt", "content": "text here"},
    {"type": "proc.exec", "cmd": "ls -la"}
  ],
  "final": "What was done"
}

AVAILABLE ACTIONS:
- fs.readFile: {"type": "fs.readFile", "path": "path/to/file"}
- fs.writeFile: {"type": "fs.writeFile", "path": "path/to/file", "content": "contents"}
- fs.listDir: {"type": "fs.listDir", "path": "path/to/dir"}
- fs.move: {"type": "fs.move", "from": "old/path", "to": "new/path"}
- fs.delete: {"type": "fs.delete", "path": "path/to/delete"}
- proc.exec: {"type": "proc.exec", "cmd": "command to run"}
- git.status: {"type": "git.status"}
- git.diff: {"type": "git.diff"}

EXAMPLES:

Task: "Create a hello.txt file"
Response:
{
  "thought_summary": "Create hello.txt with default content",
  "actions": [
    {"type": "fs.writeFile", "path": "hello.txt", "content": "Hello, World!"}
  ],
  "final": "Created hello.txt with 'Hello, World!'"
}

Task: "Add a clear button to the UI"
Response:
{
  "thought_summary": "Read index.html, add clear button to controls, update client.js with handler",
  "actions": [
    {"type": "fs.readFile", "path": "client/index.html"},
    {"type": "fs.writeFile", "path": "client/index.html", "content": "<!DOCTYPE html>...with new button..."},
    {"type": "fs.readFile", "path": "client/client.js"},
    {"type": "fs.writeFile", "path": "client/client.js", "content": "...with clear handler..."}
  ],
  "final": "Added clear button to UI with click handler that clears output"
}

CRITICAL RULES:
- TASK COMPLETION: If task says "add X", "create X", "update X" - X MUST be created/modified in your actions
- fs.readFile is PREPARATION only - you must fs.writeFile to actually complete modification tasks
- "final" message must describe what was ACTUALLY DONE, not what was planned or read
- Output ONLY the JSON object - no explanations, no markdown, no code blocks
- Every action must be explicit in the actions array
- All paths relative to: ${Deno.cwd()}
- MANDATORY: When modifying an existing file, you MUST fs.readFile it first, then fs.writeFile
- NEVER write a file without reading it first unless you're creating a brand new file
- Use the file contents from fs.readFile to make precise modifications
- If you output anything other than valid JSON, the system will error`;

export async function callAgent(
  task: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AgentResponse> {
  // Build messages array with history
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add conversation history if provided
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory);
  }

  // Add current task
  messages.push({
    role: "user",
    content: task,
  });

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: messages,
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Expected text response from Claude");
  }

  // Try to parse the response as JSON
  let responseText = content.text.trim();

  // Strip markdown code blocks if present
  if (responseText.startsWith("```")) {
    const match = responseText.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (match) {
      responseText = match[1];
    }
  }

  try {
    const parsed = JSON.parse(responseText);

    if (!validateAgentResponse(parsed)) {
      throw new Error("Invalid agent response structure");
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse agent response: ${error instanceof Error ? error.message : String(error)}\nResponse: ${responseText}`,
    );
  }
}
