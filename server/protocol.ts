// Action types that the agent can request
export type Action =
  | { type: "fs.readFile"; path: string }
  | { type: "fs.writeFile"; path: string; content: string }
  | { type: "fs.listDir"; path: string }
  | { type: "fs.move"; from: string; to: string }
  | { type: "fs.delete"; path: string }
  | { type: "proc.exec"; cmd: string }
  | { type: "git.status" }
  | { type: "git.diff" };

// Agent response structure
export interface AgentResponse {
  thought_summary: string;
  actions: Action[];
  final: string;
}

// Messages from client to server
export type ClientMessage =
  | { type: "task"; content: string }
  | { type: "git.status" }
  | { type: "git.diff" };

// Messages from server to client
export type ServerMessage =
  | { type: "log"; content: string; level: "info" | "error" | "success" }
  | { type: "action"; action: Action }
  | { type: "action_result"; success: boolean; data?: unknown; error?: string }
  | { type: "diff"; content: string }
  | { type: "status"; content: string }
  | { type: "task_complete"; summary: string };

// Validate action structure
export function validateAction(action: unknown): action is Action {
  if (!action || typeof action !== "object") return false;
  const a = action as Record<string, unknown>;

  switch (a.type) {
    case "fs.readFile":
      return typeof a.path === "string";
    case "fs.writeFile":
      return typeof a.path === "string" && typeof a.content === "string";
    case "fs.listDir":
      return typeof a.path === "string";
    case "fs.move":
      return typeof a.from === "string" && typeof a.to === "string";
    case "fs.delete":
      return typeof a.path === "string";
    case "proc.exec":
      return typeof a.cmd === "string";
    case "git.status":
    case "git.diff":
      return true;
    default:
      return false;
  }
}

// Validate agent response
export function validateAgentResponse(data: unknown): data is AgentResponse {
  if (!data || typeof data !== "object") return false;
  const resp = data as Record<string, unknown>;

  return (
    typeof resp.thought_summary === "string" &&
    Array.isArray(resp.actions) &&
    resp.actions.every(validateAction) &&
    typeof resp.final === "string"
  );
}
