import { callAgent } from "./agent.ts";
import { executeAction } from "./tools.ts";
import { AgentResponse } from "./protocol.ts";
import { buildProjectContext, formatContextForAgent } from "./context.ts";

export interface ExecutionResult {
  success: boolean;
  iterations: number;
  finalResponse?: AgentResponse;
  error?: string;
  logs: string[];
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_ITERATIONS = 5;

export async function executeTaskAgentically(
  task: string,
  onLog: (message: string, level: "info" | "error" | "success" | "action") => void,
): Promise<ExecutionResult> {
  const logs: string[] = [];
  const conversationHistory: ConversationMessage[] = [];
  let iterations = 0;

  // Build project context once
  onLog("Building project context...", "info");
  const projectContext = await buildProjectContext();
  const contextString = formatContextForAgent(projectContext);

  // Add context and task as first message
  const initialMessage = `${contextString}\n\nTASK: ${task}`;
  conversationHistory.push({ role: "user", content: initialMessage });

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    onLog(`\n--- Iteration ${iterations} ---`, "info");

    try {
      // Call agent with conversation history
      onLog("Agent is thinking...", "info");
      const response = await callAgent(task, conversationHistory);

      onLog(`Plan: ${response.thought_summary}`, "info");
      logs.push(`Iteration ${iterations}: ${response.thought_summary}`);

      // Store agent response in history
      conversationHistory.push({
        role: "assistant",
        content: JSON.stringify(response),
      });

      // Execute all actions
      let allActionsSucceeded = true;
      const actionResults: string[] = [];

      for (let i = 0; i < response.actions.length; i++) {
        const action = response.actions[i];
        onLog(`→ ${action.type} (${i + 1}/${response.actions.length})`, "action");

        const result = await executeAction(action);

        if (result.success) {
          if (result.data) {
            const dataStr = String(result.data);
            onLog(dataStr.slice(0, 500) + (dataStr.length > 500 ? "..." : ""), "info");
            actionResults.push(`${action.type}: OK - ${dataStr.slice(0, 200)}`);
          } else {
            actionResults.push(`${action.type}: OK`);
          }
        } else {
          onLog(`✗ Action failed: ${result.error}`, "error");
          actionResults.push(`${action.type}: FAILED - ${result.error}`);
          allActionsSucceeded = false;
          break; // Stop executing further actions on first failure
        }
      }

      // If all actions succeeded, task is complete
      if (allActionsSucceeded) {
        onLog(`✓ Task complete: ${response.final}`, "success");
        return {
          success: true,
          iterations,
          finalResponse: response,
          logs,
        };
      }

      // If actions failed, add feedback to conversation and try again
      const feedback = `Some actions failed. Results:\n${actionResults.join("\n")}\n\nPlease analyze the errors and try a different approach.`;
      conversationHistory.push({
        role: "user",
        content: feedback,
      });
      onLog("Retrying with error feedback...", "info");

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      onLog(`Error: ${errorMsg}`, "error");
      logs.push(`Iteration ${iterations} error: ${errorMsg}`);

      // Add error to conversation and retry
      conversationHistory.push({
        role: "user",
        content: `An error occurred: ${errorMsg}\n\nPlease try again with a different approach.`,
      });
    }
  }

  // Max iterations reached
  onLog(`✗ Task failed after ${MAX_ITERATIONS} iterations`, "error");
  return {
    success: false,
    iterations,
    error: `Failed to complete task after ${MAX_ITERATIONS} iterations`,
    logs,
  };
}
