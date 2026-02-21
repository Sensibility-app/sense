import { join } from "jsr:@std/path@^1.0.0";
import { ToolModule, ToolDefinition, ToolExecutor, validateToolModule, ToolResult } from "./tools/_shared/tool-utils.ts";
import { log, error as logError } from "./logger.ts";
import { PATHS } from "./config.ts";
import type { PersistentSession } from "./persistent-session.ts";
import type { ServerMessage } from "../shared/messages.ts";

export interface LoadedTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
  sourceFile: string;
}

export interface ToolContext {
  broadcast: (message: ServerMessage) => void;
  session: PersistentSession;
  invalidateTools: () => void;
  invalidateAgent: () => void;
}

let toolContext: ToolContext | null = null;

export function setToolContext(ctx: ToolContext): void {
  toolContext = ctx;
}

export function getToolContext(): ToolContext {
  if (!toolContext) {
    throw new Error("Tool context not initialized");
  }
  return toolContext;
}

let toolsCache: LoadedTool[] | null = null;
let cacheVersion = 0;

export function invalidateToolsCache(): void {
  toolsCache = null;
  cacheVersion++;
  log(`Tools cache invalidated (version ${cacheVersion})`);
}

export async function loadTools(): Promise<LoadedTool[]> {
  if (toolsCache) {
    return toolsCache;
  }

  const tools: LoadedTool[] = [];
  const loadedNames = new Set<string>();

  for await (const entry of Deno.readDir(PATHS.TOOLS_DIR)) {
    if (!entry.isFile || entry.name.startsWith("_") || entry.name.startsWith(".")) {
      continue;
    }

    if (!entry.name.endsWith(".ts")) {
      continue;
    }

    const toolPath = join(PATHS.TOOLS_DIR, entry.name);

    try {
      const moduleUrl = `file://${toolPath}?v=${cacheVersion}`;
      const module = await import(moduleUrl);
      const validatedModule = validateToolModule(module, entry.name);
      const definedName = validatedModule.definition.name;

      if (loadedNames.has(definedName)) {
        logError(`Tool name conflict: "${definedName}" in ${entry.name}`);
        continue;
      }

      if (definedName.includes("/") || definedName.includes("..")) {
        logError(`Invalid tool name in ${entry.name}: "${definedName}"`);
        continue;
      }

      tools.push({
        definition: validatedModule.definition,
        executor: validatedModule.executor,
        sourceFile: entry.name,
      });

      loadedNames.add(definedName);
    } catch (err) {
      logError(`Failed to load tool ${entry.name}:`, err instanceof Error ? err.message : String(err));
    }
  }

  toolsCache = tools;
  log(`Loaded ${tools.length} tools (version ${cacheVersion})`);
  return tools;
}

export async function getToolDefinitions(): Promise<ToolDefinition[]> {
  const tools = await loadTools();
  return tools.map(t => t.definition);
}

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
    return await tool.executor(input);
  } catch (err) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

