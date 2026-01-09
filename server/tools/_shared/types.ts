/**
 * TypeScript type definitions for modular MCP tools
 *
 * These types define the structure for tool modules, ensuring
 * type safety and consistency across all tools.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required: string[];
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
