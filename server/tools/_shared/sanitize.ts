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

/**
 * Resolve a search path relative to the project root
 * Handles both absolute paths (starting with /) and relative paths
 *
 * @param path - Optional path relative to project root (e.g., '/server', 'client', or '/')
 * @returns Absolute filesystem path
 *
 * @example
 * resolveSearchPath() // returns project root
 * resolveSearchPath('/') // returns project root
 * resolveSearchPath('/server') // returns /absolute/path/to/project/server
 * resolveSearchPath('client') // returns /absolute/path/to/project/client
 */
export function resolveSearchPath(path?: string): string {
  if (!path || path === '/') {
    return BASE_DIR;
  }

  // Strip leading slashes and ./ prefix to normalize
  const normalizedPath = path.replace(/^\/+/, '').replace(/^\.\//, '');

  return normalizedPath ? `${BASE_DIR}/${normalizedPath}` : BASE_DIR;
}

/**
 * Sanitize error messages to prevent filesystem path leakage
 * Replaces absolute filesystem paths with project-relative paths
 *
 * @param error - Error object or message
 * @returns Sanitized error message showing only project-relative paths
 */
export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Replace absolute filesystem paths with project-relative paths
  // Example: /home/user/Code/Sense/server/main.ts → /server/main.ts
  const sanitized = message.replace(
    new RegExp(BASE_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    ''
  );

  return sanitized;
}

/**
 * Convert relative or project-relative path to absolute filesystem path
 *
 * Handles:
 * - Absolute filesystem paths: /home/user/project/file.ts → unchanged
 * - Relative paths: ./client/app.ts → /home/user/project/client/app.ts
 * - Project-relative: client/app.ts → /home/user/project/client/app.ts
 *
 * @param filepath - Path in any format
 * @returns Absolute filesystem path
 */
export function toAbsolutePath(filepath: string): string {
  // Already absolute filesystem path
  if (filepath.startsWith(BASE_DIR)) {
    return filepath;
  }

  // Relative path - resolve against cwd
  if (filepath.startsWith("./") || filepath.startsWith("../") || !filepath.startsWith("/")) {
    return new URL(filepath, `file://${BASE_DIR}/`).pathname;
  }

  // Project-absolute path (starts with / but not full filesystem path)
  // /server/main.ts → /home/user/project/server/main.ts
  return join(BASE_DIR, filepath.slice(1));
}

/**
 * Map .js HTTP request path to .ts source file path
 * Used for transpilation routing
 *
 * @param jsPath - Path ending in .js (e.g., "/client/app.js" or "./client/app.js")
 * @returns Corresponding .ts file path
 */
export function mapJsToTs(jsPath: string): string {
  return jsPath.replace(/\.js$/, ".ts");
}
