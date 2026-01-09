/**
 * Permission system for tool security
 *
 * Tools declare required permissions. This module provides checking
 * and auditing functions. Currently informational - can be extended
 * to enforce restrictions in the future.
 */

import { ToolPermissions } from "./types.ts";

/**
 * Check if a tool has permission to perform an operation
 *
 * @param toolName - Name of tool requesting permission
 * @param permissions - Tool's declared permissions
 * @param operation - Operation to check
 * @returns true if permission granted
 */
export function checkPermission(
  toolName: string,
  permissions: ToolPermissions,
  operation: "fs:read" | "fs:write" | "exec" | "net" | "env"
): boolean {
  switch (operation) {
    case "fs:read":
      return permissions.filesystem.includes("read");
    case "fs:write":
      return permissions.filesystem.includes("write");
    case "exec":
      return permissions.execute;
    case "net":
      return permissions.network;
    case "env":
      return permissions.env || false;
    default:
      return false;
  }
}

/**
 * Log permission usage (for auditing)
 *
 * @param toolName - Name of tool using permission
 * @param operation - Operation performed
 * @param granted - Whether permission was granted
 */
export function logPermissionUse(
  toolName: string,
  operation: string,
  granted: boolean
) {
  if (!granted) {
    console.warn(`⚠️  Tool ${toolName} attempted operation ${operation} without permission`);
  }
}

/**
 * Get human-readable permission summary
 *
 * @param permissions - Tool permissions object
 * @returns Human-readable string describing permissions
 */
export function describePermissions(permissions: ToolPermissions): string {
  const parts: string[] = [];

  if (permissions.filesystem.length > 0) {
    parts.push(`Filesystem: ${permissions.filesystem.join(", ")}`);
  }
  if (permissions.network) {
    parts.push("Network: yes");
  }
  if (permissions.execute) {
    parts.push("Execute: yes");
  }
  if (permissions.env) {
    parts.push("Environment: yes");
  }

  return parts.join(" | ") || "No permissions";
}
