/**
 * In-memory TypeScript transpilation with caching
 *
 * This module provides TypeScript → JavaScript transpilation using the
 * TypeScript compiler, with hash-based caching for performance.
 *
 * Each .ts file is transpiled individually and served as a separate .js module,
 * letting the browser handle ES6 module imports naturally.
 */

import * as ts from "npm:typescript@5.7.3";
import { crypto } from "jsr:@std/crypto@1.0.3";
import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";
import { log, error as logError } from "./logger.ts";

interface CacheEntry {
  sourceHash: string;
  transpiledCode: string;
  timestamp: number;
}

/**
 * In-memory cache for transpiled TypeScript code
 */
class TranspilationCache {
  private cache = new Map<string, CacheEntry>();

  get(filepath: string, sourceHash: string): string | null {
    const entry = this.cache.get(filepath);
    if (entry && entry.sourceHash === sourceHash) {
      return entry.transpiledCode;
    }
    return null;
  }

  set(filepath: string, sourceHash: string, transpiledCode: string): void {
    this.cache.set(filepath, {
      sourceHash,
      transpiledCode,
      timestamp: Date.now(),
    });
  }

  invalidate(filepath: string): void {
    this.cache.delete(filepath);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global cache instance
const cache = new TranspilationCache();

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
 * Transpile TypeScript source code to JavaScript
 *
 * @param tsCode - TypeScript source code
 * @param filepath - File path (for error messages)
 * @returns Transpiled JavaScript code
 * @throws Error if transpilation fails
 */
function transpileTypeScript(tsCode: string, filepath: string): string {
  // TypeScript compiler options optimized for browser
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    lib: ["ES2020", "DOM"],
    strict: false, // Don't block on type errors (JavaScript is still valid)
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowSyntheticDefaultImports: true,
    removeComments: false,
    sourceMap: false, // In-memory, no source maps for now
  };

  // Transpile TypeScript to JavaScript
  const result = ts.transpileModule(tsCode, {
    compilerOptions,
    fileName: filepath,
    reportDiagnostics: true,
  });

  // Check for errors (syntax errors, not type errors)
  if (result.diagnostics && result.diagnostics.length > 0) {
    const errors = result.diagnostics
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => {
        const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
        if (d.file && d.start !== undefined) {
          const { line, character } = d.file.getLineAndCharacterOfPosition(
            d.start,
          );
          return `${filepath}:${line + 1}:${character + 1} - ${message}`;
        }
        return message;
      });

    if (errors.length > 0) {
      throw new Error(`TypeScript transpilation failed:\n${errors.join("\n")}`);
    }
  }

  // Replace .ts with .js in import paths
  const jsCode = replaceImportExtensions(result.outputText);

  return jsCode;
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
    // Read source file
    const tsCode = await Deno.readTextFile(filepath);

    // Calculate hash of source
    const sourceHash = await hashSource(tsCode);

    // Check cache
    const cached = cache.get(filepath, sourceHash);
    if (cached) {
      // Cache hit - return immediately
      return cached;
    }

    // Cache miss - transpile TypeScript
    log(`📦 Transpiling ${filepath}...`);
    const startTime = performance.now();

    const jsCode = transpileTypeScript(tsCode, filepath);

    const duration = (performance.now() - startTime).toFixed(0);
    log(`✅ Transpilation complete (${duration}ms, ${jsCode.length} bytes)`);

    // Cache the result
    cache.set(filepath, sourceHash, jsCode);

    return jsCode;
  } catch (err) {
    // Transpilation or file read failed
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError(`❌ TypeScript transpilation error for ${filepath}:`, errorMessage);

    // Try to return last cached version (any hash)
    const entry = (cache as any).cache.get(filepath);
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
  cache.invalidate(filepath);
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
    size: cache.size(),
    files: (cache as any).cache.size,
  };
}
