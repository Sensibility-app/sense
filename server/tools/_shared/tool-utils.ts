import { sanitizeErrorMessage } from "./sanitize.ts";
import type { ContentPart } from "../../shared/messages.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    $schema?: string;
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      default?: unknown;
      enum?: unknown[];
      items?: unknown;
    }>;
    required?: string[];
    additionalProperties?: boolean;
  };
  cache_control?: { type: "ephemeral" };
}

export interface ToolResult {
  content: string | ContentPart[];
  isError: boolean;
}

export type ToolExecutor = (input: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

export interface ToolModule {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export function validateToolModule(module: unknown, filename: string): ToolModule {
  const m = module as Record<string, unknown>;
  if (!m.definition || typeof m.definition !== "object") {
    throw new Error(`Tool ${filename}: Missing or invalid 'definition' export`);
  }
  if (!m.executor || typeof m.executor !== "function") {
    throw new Error(`Tool ${filename}: Missing or invalid 'executor' export`);
  }
  return m as unknown as ToolModule;
}

function validateInput(input: Record<string, unknown>, schema: ToolDefinition["input_schema"]): ToolResult | null {
  for (const field of schema.required || []) {
    const value = input[field];
    if (value === undefined || value === null) {
      return { content: `${field} is required`, isError: true };
    }
    if (schema.properties[field]?.type === "string" && value === "") {
      return { content: `${field} cannot be empty`, isError: true };
    }
  }
  return null;
}

export function createTool(
  definition: Omit<ToolDefinition, "input_schema"> & { input_schema: Omit<ToolDefinition["input_schema"], "$schema" | "additionalProperties"> },
  executor: ToolExecutor
): ToolModule {
  const fullDefinition: ToolDefinition = {
    ...definition,
    input_schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: false,
      ...definition.input_schema,
    },
  };

  const wrappedExecutor: ToolExecutor = async (input) => {
    const validationError = validateInput(input, fullDefinition.input_schema);
    if (validationError) return validationError;

    try {
      return await executor(input);
    } catch (error) {
      return { content: sanitizeErrorMessage(error), isError: true };
    }
  };

  return { definition: fullDefinition, executor: wrappedExecutor };
}

export const BINARY_FILE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
  'pdf', 'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib',
  'mp3', 'wav', 'ogg', 'flac', 'aac',
  'mp4', 'avi', 'mkv', 'mov', 'wmv',
  'ttf', 'otf', 'woff', 'woff2',
];

export const SKIP_DIRECTORY_PATTERNS = [
  /node_modules/, /\.git/, /sessions/, /dist/, /build/, /coverage/, /\.next/, /\.cache/,
];

export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_FILE_EXTENSIONS.includes(ext) : false;
}
