/**
 * In-memory TypeScript transpilation with caching
 *
 * This module provides TypeScript → JavaScript transpilation using the
 * TypeScript compiler, with hash-based caching for performance.
 */

import * as ts from "npm:typescript@5.7.3";
import { crypto } from "jsr:@std/crypto@1.0.3";
import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";
import { join, dirname } from "jsr:@std/path@^1.0.0";
import { log, error as logError } from "./logger.ts";

const CLIENT_TS_PATH = "./client/client.ts";
const CLIENT_DIR = "./client";

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
 * Extract import statements from TypeScript source
 * Returns array of imported file paths
 */
function extractImports(source: string, currentFile: string): string[] {
  const imports: string[] = [];

  // Match: import ... from "./file.ts"
  // Match: import ... from './file.ts'
  // Use [\s\S] to match newlines in multi-line imports
  const importRegex = /import\s+[\s\S]*?\s+from\s+['"](.+?)['"]/g;

  let match;
  while ((match = importRegex.exec(source)) !== null) {
    const importPath = match[1];

    // Only process relative imports (starting with ./ or ../)
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      // Resolve relative to current file's directory
      const currentDir = dirname(currentFile);
      const resolvedPath = join(currentDir, importPath);
      imports.push(resolvedPath);
    }
  }

  return imports;
}

/**
 * Recursively collect all TypeScript module sources
 * Returns Map of filepath → source code
 */
async function collectModuleSources(
  entryPoint: string,
  visited = new Set<string>()
): Promise<Map<string, string>> {
  const sources = new Map<string, string>();

  // Prevent infinite loops
  if (visited.has(entryPoint)) {
    return sources;
  }
  visited.add(entryPoint);

  try {
    // Read the file
    const source = await Deno.readTextFile(entryPoint);
    sources.set(entryPoint, source);

    // Extract imports from this file
    const imports = extractImports(source, entryPoint);

    // Recursively collect imported modules
    for (const importPath of imports) {
      const importedSources = await collectModuleSources(importPath, visited);
      // Merge imported sources (dependencies first)
      for (const [path, src] of importedSources) {
        sources.set(path, src);
      }
    }
  } catch (err) {
    logError(`Failed to read module ${entryPoint}:`, err);
    throw new Error(`Module not found: ${entryPoint}`);
  }

  return sources;
}

/**
 * Bundle multiple TypeScript modules into a single JavaScript output
 * Uses TypeScript compiler to handle module resolution and bundling
 */
async function bundleModules(entryPoint: string): Promise<string> {
  // Collect all module sources
  const moduleSources = await collectModuleSources(entryPoint);

  log(`📦 Bundling ${moduleSources.size} module(s)...`);

  // Create a virtual file system for TypeScript compiler
  const fileNames = Array.from(moduleSources.keys());

  // Compiler options for bundling
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
    lib: ["ES2020", "DOM"],
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowSyntheticDefaultImports: true,
    removeComments: false,
    sourceMap: false,
    outFile: undefined, // Don't use outFile, handle manually
  };

  // Create a simple in-memory bundler by inlining all modules
  // This approach: transpile each module and concatenate them
  const transpiledModules: string[] = [];

  for (const [filepath, source] of moduleSources) {
    try {
      const result = ts.transpileModule(source, {
        compilerOptions,
        fileName: filepath,
        reportDiagnostics: true,
      });

      // Check for errors
      if (result.diagnostics && result.diagnostics.length > 0) {
        const errors = result.diagnostics
          .filter((d) => d.category === ts.DiagnosticCategory.Error)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

        if (errors.length > 0) {
          throw new Error(`${filepath}: ${errors.join("\n")}`);
        }
      }

      // Remove import/export statements for bundling
      // This is a simple approach: convert exports to const declarations
      let code = result.outputText;

      // Remove "export " keywords but keep the declarations
      code = code.replace(/export\s+/g, '');

      // Remove import statements (they're already resolved)
      code = code.replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '');

      transpiledModules.push(`// Module: ${filepath}\n${code}\n`);
    } catch (err) {
      throw new Error(`Failed to transpile ${filepath}: ${err}`);
    }
  }

  // Combine all modules into single output
  // Wrap in IIFE to avoid global scope pollution
  const bundled = `(function() {\n${transpiledModules.join('\n')}\n})();`;

  return bundled;
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

  return result.outputText;
}

/**
 * Get transpiled client JavaScript from client.ts
 *
 * Reads client.ts (and any imported modules), checks cache, transpiles/bundles
 * if needed, and returns JavaScript. If transpilation fails, returns last
 * known good version (if available).
 *
 * @returns Object with transpiled code and optional error message
 */
export async function getTranspiledClient(): Promise<
  { code: string; error?: string }
> {
  try {
    // Collect all module sources (including imports)
    const moduleSources = await collectModuleSources(CLIENT_TS_PATH);

    // Calculate combined hash of all sources
    const combinedSource = Array.from(moduleSources.values()).join('\n---\n');
    const sourceHash = await hashSource(combinedSource);

    // Check cache
    const cached = cache.get(CLIENT_TS_PATH, sourceHash);
    if (cached) {
      // Cache hit - return immediately
      return { code: cached };
    }

    // Cache miss - bundle and transpile TypeScript modules
    log(`📦 Transpiling client (${moduleSources.size} module(s))...`);
    const startTime = performance.now();

    const jsCode = await bundleModules(CLIENT_TS_PATH);

    const duration = (performance.now() - startTime).toFixed(0);
    log(`✅ Transpilation complete (${duration}ms, ${jsCode.length} bytes)`);

    // Cache the result
    cache.set(CLIENT_TS_PATH, sourceHash, jsCode);

    return { code: jsCode };
  } catch (err) {
    // Transpilation or file read failed
    const errorMessage = err instanceof Error ? err.message : String(err);
    logError("❌ TypeScript transpilation error:", errorMessage);

    // Try to return last cached version (any hash)
    const entries = Array.from((cache as any).cache.values());
    if (entries.length > 0) {
      const lastEntry = entries[entries.length - 1] as CacheEntry;
      logError("⚠️  Serving last known good version from cache");
      return {
        code: lastEntry.transpiledCode,
        error: errorMessage,
      };
    }

    // No cached version available - return error
    throw new Error(`Cannot transpile client.ts: ${errorMessage}`);
  }
}

/**
 * Invalidate cache for a specific file
 */
export function invalidateClientCache(): void {
  cache.invalidate(CLIENT_TS_PATH);
  log("🗑️  Client transpilation cache invalidated");
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
