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
 * @param path - Relative or absolute path
 * @returns Absolute path within project root
 * @throws Error if path traversal detected
 */
export function sanitizePath(path: string): string {
  const resolved = join(BASE_DIR, path);
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
