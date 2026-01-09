/**
 * Consolidated tool utilities
 *
 * This module provides type definitions, validation helpers, and file utilities
 * for all MCP-style tools in the Sense system.
 */

import { sanitizeErrorMessage } from "./sanitize.ts";

// =============================================================================
// TYPES
// =============================================================================

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
    }>;
    required: string[];
    additionalProperties?: boolean;
  };
  cache_control?: { type: "ephemeral" };  // For prompt caching
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

export type ToolExecutor = (
  input: Record<string, unknown>
) => Promise<ToolResult> | ToolResult;

export interface ToolPermissions {
  filesystem: ("read" | "write")[];  // fs:read, fs:write
  network: boolean;                   // net permission
  execute: boolean;                   // Command execution
  env?: boolean;                      // Environment variable access
}

/**
 * Permission presets for common tool patterns
 * Use these instead of manually declaring permissions in each tool
 */
export const PERMISSIONS = {
  NONE: {
    filesystem: [] as ("read" | "write")[],
    network: false,
    execute: false,
  },
  READ_ONLY: {
    filesystem: ["read"] as ("read" | "write")[],
    network: false,
    execute: false,
  },
  READ_WRITE: {
    filesystem: ["read", "write"] as ("read" | "write")[],
    network: false,
    execute: false,
  },
  WRITE_ONLY: {
    filesystem: ["write"] as ("read" | "write")[],
    network: false,
    execute: false,
  },
  EXECUTE: {
    filesystem: ["read", "write"] as ("read" | "write")[],
    network: false,
    execute: true,
  },
  NETWORK: {
    filesystem: [] as ("read" | "write")[],
    network: true,
    execute: false,
  },
} as const;

export interface ToolModule {
  definition: ToolDefinition;
  executor: ToolExecutor;
  permissions: ToolPermissions;
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
  };
}

/**
 * Validate a tool module has all required exports
 * Throws detailed error if validation fails
 */
export function validateToolModule(module: any, filename: string): ToolModule {
  // Check for required exports
  if (!module.definition || typeof module.definition !== "object") {
    throw new Error(`Tool ${filename}: Missing or invalid 'definition' export`);
  }
  if (!module.executor || typeof module.executor !== "function") {
    throw new Error(`Tool ${filename}: Missing or invalid 'executor' export`);
  }
  if (!module.permissions || typeof module.permissions !== "object") {
    throw new Error(`Tool ${filename}: Missing or invalid 'permissions' export`);
  }

  // Validate definition structure
  if (!module.definition.name || typeof module.definition.name !== "string") {
    throw new Error(`Tool ${filename}: definition.name must be a string`);
  }
  if (!module.definition.description || typeof module.definition.description !== "string") {
    throw new Error(`Tool ${filename}: definition.description must be a string`);
  }
  if (!module.definition.input_schema) {
    throw new Error(`Tool ${filename}: definition.input_schema is required`);
  }

  // Validate permissions structure
  if (!Array.isArray(module.permissions.filesystem)) {
    throw new Error(`Tool ${filename}: permissions.filesystem must be an array`);
  }
  if (typeof module.permissions.network !== "boolean") {
    throw new Error(`Tool ${filename}: permissions.network must be a boolean`);
  }
  if (typeof module.permissions.execute !== "boolean") {
    throw new Error(`Tool ${filename}: permissions.execute must be a boolean`);
  }

  return module as ToolModule;
}

/**
 * Wrap a tool executor with automatic error handling
 * Catches any errors and converts them to ToolResult with sanitized error messages
 */
export function withErrorHandling(executor: ToolExecutor): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return await executor(input);
    } catch (error) {
      return {
        content: sanitizeErrorMessage(error),
        isError: true,
      };
    }
  };
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate a field's type and constraints
 * Returns error message if invalid, null if valid
 */
function validateFieldType(
  field: string,
  value: unknown,
  fieldSchema: { type: string; enum?: unknown[] },
  isRequired: boolean
): string | null {
  const expectedType = fieldSchema.type;
  const actualType = typeof value;

  // Type validation
  const suffix = isRequired ? "" : " if provided";

  if (expectedType === "string" && actualType !== "string") {
    return `${field} must be a string${suffix}`;
  }
  if (expectedType === "number" && actualType !== "number") {
    return `${field} must be a number${suffix}`;
  }
  if (expectedType === "boolean" && actualType !== "boolean") {
    return `${field} must be a boolean${suffix}`;
  }

  // Empty string check for string fields
  if (isRequired && expectedType === "string" && actualType === "string" && value === "") {
    return `${field} cannot be empty`;
  }

  // Enum validation
  if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
    return `${field} must be one of: ${fieldSchema.enum.join(", ")}`;
  }

  return null;
}

/**
 * Validate tool input against its schema
 * Returns a ToolResult with error if validation fails, null if valid
 */
export function validateInput(
  input: Record<string, unknown>,
  schema: ToolDefinition["input_schema"]
): ToolResult | null {
  // Check required fields
  for (const field of schema.required || []) {
    const value = input[field];

    if (value === undefined || value === null) {
      return { content: `${field} is required`, isError: true };
    }

    const fieldSchema = schema.properties[field];
    if (!fieldSchema) continue;

    const error = validateFieldType(field, value, fieldSchema, true);
    if (error) {
      return { content: error, isError: true };
    }
  }

  // Check optional fields if provided
  for (const field in input) {
    if (!schema.required?.includes(field) && schema.properties[field]) {
      const value = input[field];

      // Skip undefined/null optional fields
      if (value === undefined || value === null) continue;

      const error = validateFieldType(field, value, schema.properties[field], false);
      if (error) {
        return { content: error, isError: true };
      }
    }
  }

  // All validation passed
  return null;
}

// =============================================================================
// FILE UTILITIES
// =============================================================================

/**
 * Binary file extensions that should be skipped when searching or processing files
 */
export const BINARY_FILE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',  // Images
  'pdf',                                                        // Documents
  'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',              // Archives
  'exe', 'dll', 'so', 'dylib',                                 // Binaries
  'mp3', 'wav', 'ogg', 'flac', 'aac',                         // Audio
  'mp4', 'avi', 'mkv', 'mov', 'wmv',                          // Video
  'ttf', 'otf', 'woff', 'woff2',                              // Fonts
];

/**
 * Directory patterns that should be skipped when walking the filesystem
 */
export const SKIP_DIRECTORY_PATTERNS = [
  /node_modules/,
  /\.git/,
  /\.sense/,
  /dist/,
  /build/,
  /coverage/,
  /\.next/,
  /\.cache/,
];

/**
 * Check if a file is binary based on its extension
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? BINARY_FILE_EXTENSIONS.includes(ext) : false;
}

/**
 * Check if a path should be skipped based on directory patterns
 */
export function shouldSkipDirectory(path: string): boolean {
  return SKIP_DIRECTORY_PATTERNS.some(pattern => pattern.test(path));
}
