/**
 * MCP-style tool definitions and execution
 *
 * This module now exports from the dynamic tool loader system.
 * Tools are loaded from /server/tools/ directory at runtime.
 *
 * For backward compatibility, TOOLS is exported as an await expression.
 */

import { getToolDefinitions, executeTool as executeToolDynamic, loadTools, clearToolCache, getTool } from "./tools-loader.ts";

// Export tool definitions (loaded dynamically from /server/tools/)
// Uses top-level await to load tools on module import
export const TOOLS = await getToolDefinitions();

// Export executeTool function (delegates to dynamic loader)
export const executeTool = executeToolDynamic;

// Export additional loader functions for advanced usage
export { loadTools, clearToolCache, getTool };
