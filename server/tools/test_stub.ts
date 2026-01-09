/**
 * test_stub tool - A simple test tool to verify dynamic loading
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";

export const permissions: ToolPermissions = {
  filesystem: false,
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "test_stub",
  description: "A simple test tool that returns a greeting message with the provided name",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name to include in the greeting"
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  if (!input.name || typeof input.name !== "string") {
    return {
      content: "name is required and must be a string",
      isError: true,
    };
  }

  const greeting = `Hello ${input.name}! This is a test stub tool. Current time: ${new Date().toISOString()}`;

  return {
    content: greeting,
    isError: false,
  };
};