/**
 * hello_world tool - A simple test tool for the dynamic system
 *
 * Returns a greeting message with optional customization.
 */

import { ToolDefinition, ToolExecutor, ToolPermissions, ToolResult } from "../tools/_shared/types.ts";

export const permissions: ToolPermissions = {
  filesystem: false,
  network: false,
  execute: false,
};

export const definition: ToolDefinition = {
  name: "hello_world",
  description: "A simple test tool that returns a greeting message",
  input_schema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Optional: Name to include in the greeting"
      },
      language: {
        type: "string",
        description: "Optional: Language for the greeting (en, es, fr)",
        enum: ["en", "es", "fr"]
      },
    },
    required: [],
    additionalProperties: false,
  },
};

export const executor: ToolExecutor = async (input): Promise<ToolResult> => {
  const name = input.name || "World";
  const language = input.language || "en";
  
  let greeting: string;
  
  switch (language) {
    case "es":
      greeting = `¡Hola, ${name}!`;
      break;
    case "fr":
      greeting = `Bonjour, ${name}!`;
      break;
    case "en":
    default:
      greeting = `Hello, ${name}!`;
      break;
  }
  
  const timestamp = new Date().toISOString();
  const message = `${greeting} This is a test tool created at ${timestamp}. The dynamic system is working!`;
  
  return { 
    content: message, 
    isError: false 
  };
};