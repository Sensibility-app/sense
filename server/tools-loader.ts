/**
 * Dynamic tool loader for modular MCP tools
 *
 * Scans /server/tools/ directory and dynamically imports tool modules.
 * Each tool exports: { definition, executor, permissions }
 *
 * Features:
 * - Directory scanning with Deno.readDir()
 * - Dynamic import() with file:// URLs
 * - Module validation with validateToolModule()
 * - Error handling (syntax errors don't crash server)
 * - Tool name conflict detection
 * - Caching for performance
 */

import { join, basename } from "jsr:@std/path@^1.0.0";
import { ToolModule, ToolDefinition, ToolExecutor, ToolPermissions, validateToolModule, ToolResult } from "./tools/_shared/tool-utils.ts";
import { log, error as logError } from "./logger.ts";

const TOOLS_DIR = join(Deno.cwd(), "server", "tools");
const SHARED_DIR = "_shared";

interface LoadedTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
  permissions: ToolPermissions;
  sourceFile: string;
}

// Cache loaded tools (cleared on reload)
let toolCache: Map<string, LoadedTool> | null = null;

/**
 * Load all tools from /server/tools/ directory
 * Uses dynamic import() to load .ts files as modules
 *
 * @returns Array of loaded tools with definitions and executors
 */
export async function loadTools(): Promise<LoadedTool[]> {
  // Return cached tools if available
  if (toolCache) {
    return Array.from(toolCache.values());
  }

  const tools: LoadedTool[] = [];
  const loadedNames = new Set<string>();

  log("Loading tools from:", TOOLS_DIR);

  try {
    // Scan tools directory
    for await (const entry of Deno.readDir(TOOLS_DIR)) {
      // Skip non-files, shared directory, and hidden files
      if (!entry.isFile || entry.name.startsWith("_") || entry.name.startsWith(".")) {
        continue;
      }

      // Only load .ts files
      if (!entry.name.endsWith(".ts")) {
        continue;
      }

      const toolPath = join(TOOLS_DIR, entry.name);
      const toolName = basename(entry.name, ".ts");

      try {
        // Dynamic import (Deno supports this natively)
        // Use file:// URL for proper module resolution
        const moduleUrl = `file://${toolPath}`;
        const module = await import(moduleUrl);

        // Validate module exports
        const validatedModule = validateToolModule(module, entry.name);

        // Check for naming conflicts
        const definedName = validatedModule.definition.name;
        if (loadedNames.has(definedName)) {
          logError(`Tool name conflict: "${definedName}" defined in ${entry.name} already exists`);
          continue;
        }

        // Prevent path traversal in tool names
        if (definedName.includes("/") || definedName.includes("..")) {
          logError(`Invalid tool name in ${entry.name}: "${definedName}" (no path separators allowed)`);
          continue;
        }

        tools.push({
          definition: validatedModule.definition,
          executor: validatedModule.executor,
          permissions: validatedModule.permissions,
          sourceFile: entry.name,
        });

        loadedNames.add(definedName);
        log(`✓ Loaded tool: ${definedName} (from ${entry.name})`);

      } catch (err) {
        // Log error but continue loading other tools
        logError(`Failed to load tool ${entry.name}:`, err instanceof Error ? err.message : String(err));

        // In development, show syntax errors prominently
        if (Deno.env.get("DENO_TASK_NAME") === "dev" && err instanceof Error) {
          console.error(`\nSyntax error in ${entry.name}:\n`, err.stack);
        }
      }
    }

    // Cache the loaded tools
    toolCache = new Map(tools.map(t => [t.definition.name, t]));

    log(`Loaded ${tools.length} tools successfully`);
    return tools;

  } catch (err) {
    logError("Failed to scan tools directory:", err);
    throw new Error(`Tool loading failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Clear tool cache (forces reload on next loadTools() call)
 * Called by watch mode when files change
 */
export function clearToolCache() {
  toolCache = null;
  log("Tool cache cleared");
}

/**
 * Get tool definitions for Claude API
 *
 * @returns Array of tool definitions to pass to Claude
 */
export async function getToolDefinitions(): Promise<ToolDefinition[]> {
  const tools = await loadTools();
  return tools.map(t => t.definition);
}

/**
 * Execute a tool by name
 *
 * @param name - Tool name to execute
 * @param input - Tool input parameters
 * @returns Tool execution result
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const tools = await loadTools();
  const tool = tools.find(t => t.definition.name === name);

  if (!tool) {
    return {
      content: `Unknown tool: ${name}`,
      isError: true,
    };
  }

  try {
    // Execute the tool
    const result = await tool.executor(input);
    return result;
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

/**
 * Get tool by name (for inspection/debugging)
 *
 * @param name - Tool name to retrieve
 * @returns Tool object or undefined if not found
 */
export async function getTool(name: string): Promise<LoadedTool | undefined> {
  const tools = await loadTools();
  return tools.find(t => t.definition.name === name);
}
