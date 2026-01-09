/**
 * In-memory TypeScript transpilation with caching
 *
 * This module provides TypeScript → JavaScript transpilation using Deno's
 * official @deno/emit module, with hash-based caching for performance.
 *
 * Each .ts file is transpiled individually and served as a separate .js module,
 * letting the browser handle ES6 module imports naturally.
 *
 * Uses JSR imports for evergreen deployment (runtime importable, no restart needed).
 */

import { transpile } from "jsr:@deno/emit";
import { crypto } from "jsr:@std/crypto@1.0.3";
import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";
import { log, error as logError } from "./logger.ts";

/**
 * Callback for transpilation events
 * Called when transpilation completes (fresh or cached)
 *
 * Used by:
 * 1. HTTP handler for on-demand transpilation (when browser requests .js files)
 * 2. File watcher for proactive transpilation on file changes (edit → transpile → reload)
 *
 * @param filepath - Absolute path to TypeScript file that was transpiled
 * @param fromCache - true if served from cache (no reload), false if fresh (trigger reload)
 */
type TranspileCallback = (filepath: string, fromCache: boolean) => void;
let onTranspileComplete: TranspileCallback | null = null;

export function setTranspileCallback(callback: TranspileCallback | null) {
  onTranspileComplete = callback;
}

interface CacheEntry {
  sourceHash: string;
  transpiledCode: string;
  timestamp: number;
}

/**
 * In-memory cache for transpiled TypeScript code
 */
const cache = new Map<string, CacheEntry>();

function getCached(filepath: string, sourceHash: string): string | null {
  const entry = cache.get(filepath);
  return (entry && entry.sourceHash === sourceHash) ? entry.transpiledCode : null;
}

function setCached(filepath: string, sourceHash: string, transpiledCode: string): void {
  cache.set(filepath, { sourceHash, transpiledCode, timestamp: Date.now() });
}

/**
 * Calculate SHA-256 hash of source code
 */
async function hashSource(source: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(source);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return encodeHex(hashBuffer);
}

/**
 * Replace .ts extensions with .js in import statements
 */
function replaceImportExtensions(code: string): string {
  // Replace import paths ending with .ts to .js
  return code.replace(/from\s+['"](.+?)\.ts['"]/g, 'from "$1.js"');
}




/**
 * Transpile TypeScript source code to JavaScript using @deno/emit
 *
 * @param filepath - Absolute file path to transpile
 * @returns Transpiled JavaScript code with .ts → .js import rewriting
 * @throws Error if transpilation fails
 */
async function transpileTypeScript(filepath: string): Promise<string> {
  try {
    // Convert file path to file:// URL for @deno/emit
    const url = new URL(`file://${filepath}`);

    // Transpile using @deno/emit
    const result = await transpile(url);

    // Get the transpiled code
    const jsCode = result.get(url.href);

    if (!jsCode) {
      throw new Error(`Transpilation produced no output for ${filepath}`);
    }

    // Replace .ts with .js in import paths for browser compatibility
    return replaceImportExtensions(jsCode);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`TypeScript transpilation failed for ${filepath}: ${errorMessage}`);
  }
}

/**
 * Transpile a TypeScript file to JavaScript
 *
 * Reads a .ts file, checks cache, transpiles if needed, and returns JavaScript.
 * Import paths are automatically rewritten from .ts to .js for browser compatibility.
 *
 * @param filepath - Path to TypeScript file (e.g., "./client/client.ts")
 * @returns Transpiled JavaScript code
 * @throws Error if file read or transpilation fails
 */
export async function transpileFile(filepath: string): Promise<string> {
  try {
    // Convert to absolute path for consistent caching
    const absolutePath = filepath.startsWith("/")
      ? filepath
      : new URL(filepath, `file://${Deno.cwd()}/`).pathname;

    // Read source file
    const tsCode = await Deno.readTextFile(absolutePath);

    // Calculate hash of source
    const sourceHash = await hashSource(tsCode);

    // Check cache (use absolute path as key)
    const cached = getCached(absolutePath, sourceHash);
    if (cached) {
      // Cache hit - return immediately
      if (onTranspileComplete) {
        onTranspileComplete(filepath, true);
      }
      return cached;
    }

    // Cache miss - transpile TypeScript
    log(`📦 Transpiling ${filepath}...`);
    const startTime = performance.now();

    const jsCode = await transpileTypeScript(absolutePath);

    const duration = (performance.now() - startTime).toFixed(0);
    log(`✅ Transpilation complete (${duration}ms, ${jsCode.length} bytes)`);

    // Cache the result
    setCached(absolutePath, sourceHash, jsCode);

    // Notify callback about fresh transpilation
    if (onTranspileComplete) {
      onTranspileComplete(filepath, false);
    }

    return jsCode;
  } catch (err) {
    // Transpilation or file read failed
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError(`❌ TypeScript transpilation error for ${filepath}:`, errorMessage);

    // Convert to absolute path to check cache
    const absolutePath = filepath.startsWith("/")
      ? filepath
      : new URL(filepath, `file://${Deno.cwd()}/`).pathname;

    // Try to return last cached version (any hash)
    const entry = cache.get(absolutePath);
    if (entry) {
      logError("⚠️  Serving last known good version from cache");
      return entry.transpiledCode;
    }

    // No cached version available - return error
    throw new Error(`Cannot transpile ${filepath}: ${errorMessage}`);
  }
}

/**
 * Invalidate cache for a specific file
 */
export function invalidateCache(filepath: string): void {
  cache.delete(filepath);
  log(`🗑️  Transpilation cache invalidated for ${filepath}`);
}

/**
 * Clear all caches
 */
export function clearCache(): void {
  cache.clear();
  log("🗑️  All transpilation caches cleared");
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: cache.size,
    files: cache.size,
  };
}
