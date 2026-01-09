/**
 * Path sanitization utilities
 *
 * Security functions to prevent path traversal attacks and ensure
 * all file operations stay within the project directory.
 */

import { join } from "jsr:@std/path@^1.0.0";

const BASE_DIR = Deno.cwd();

/**
 * Ensure path is safe and within project
 * Prevents path traversal attacks
 *
 * Accepts two formats:
 * - Absolute within project: /server/main.ts (leading slash)
 * - Relative to project: server/main.ts (no leading slash)
 *
 * @param path - Path within project (e.g., "/server/main.ts" or "server/main.ts")
 * @returns Absolute filesystem path within project root
 * @throws Error if path traversal detected
 */
export function sanitizePath(path: string): string {
  // Remove leading slash if present (converts absolute project path to relative)
  // Special case: "/" means project root
  const cleanPath = path === "/" ? "" : (path.startsWith('/') ? path.slice(1) : path);

  const resolved = join(BASE_DIR, cleanPath);
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/**
 * Get base directory (project root)
 *
 * @returns Absolute path to project root
 */
export function getBaseDir(): string {
  return BASE_DIR;
}
