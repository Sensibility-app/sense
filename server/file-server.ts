import { transpile } from "jsr:@deno/emit";
import { crypto } from "jsr:@std/crypto@^1.0.0";
import { encodeHex } from "jsr:@std/encoding@^1.0.0/hex";
import { log, error } from "./logger.ts";
import { join, normalize } from "jsr:@std/path@^1.0.0";

const BASE_DIR = Deno.cwd();
const cache = new Map<string, { sourceHash: string; transpiledCode: string }>();

function toAbsolutePath(filepath: string): string {
  if (filepath.startsWith(BASE_DIR)) return filepath;
  const cleanPath = filepath.replace(/^\.?\//, "");
  return normalize(join(BASE_DIR, cleanPath));
}

function replaceImportExtensions(code: string): string {
  return code.replace(/from\s+['"](.+?)\.ts['"]/g, 'from "$1.js"');
}

async function transpileFile(filepath: string): Promise<{ code: string; fromCache: boolean }> {
  try {
    const absolutePath = toAbsolutePath(filepath);
    const tsCode = await Deno.readTextFile(absolutePath);

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tsCode));
    const sourceHash = encodeHex(hashBuffer);

    const cached = cache.get(absolutePath);
    if (cached && cached.sourceHash === sourceHash) {
      return { code: cached.transpiledCode, fromCache: true };
    }

    log(`Transpiling ${filepath}...`);
    const startTime = performance.now();

    const url = new URL(`file://${absolutePath}`);
    const result = await transpile(url);
    const jsCode = result.get(url.href);

    if (!jsCode) throw new Error(`Transpilation produced no output for ${filepath}`);

    const transpiledCode = replaceImportExtensions(jsCode);
    const duration = (performance.now() - startTime).toFixed(0);
    log(`Transpilation complete (${duration}ms, ${transpiledCode.length} bytes)`);

    cache.set(absolutePath, { sourceHash, transpiledCode });
    return { code: transpiledCode, fromCache: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    error(`TypeScript transpilation error for ${filepath}:`, errorMessage);

    const absolutePath = toAbsolutePath(filepath);
    const entry = cache.get(absolutePath);
    if (entry) {
      error("Warning: Serving last known good version from cache");
      return { code: entry.transpiledCode, fromCache: true };
    }

    throw new Error(`Cannot transpile ${filepath}: ${errorMessage}`);
  }
}

export async function serveStaticFile(pathname: string): Promise<Response> {
  const isTranspilable = (pathname.startsWith("/client/") || pathname.startsWith("/shared/")) && pathname.endsWith(".js");
  
  if (isTranspilable) {
    try {
      const tsPath = `.${pathname.replace(/\.js$/, ".ts")}`;
      const { code } = await transpileFile(tsPath);

      return new Response(code, {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    } catch (err) {
      error("Transpilation error:", err);
      return new Response(`// Transpilation error: ${err instanceof Error ? err.message : String(err)}`, {
        status: 500,
        headers: { "Content-Type": "text/javascript" },
      });
    }
  }

  const path = pathname === "/" ? "/client/index.html" : pathname;
  return serveFile(`.${path}`);
}

async function serveFile(path: string): Promise<Response> {
  try {
    const ext = path.split(".").pop();
    const contentTypes: Record<string, string> = {
      html: "text/html", js: "text/javascript", css: "text/css", json: "application/json",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", ico: "image/x-icon"
    };
    const contentType = contentTypes[ext || ""] || "text/plain";

    if (ext === "html") {
      const html = await Deno.readTextFile(path);
      const rewritten = html.replace(/(<script[^>]+src=["'])([^"']+)\.ts(["'][^>]*>)/g, '$1$2.js$3');
      return new Response(rewritten, {
        headers: { "Content-Type": contentType, "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
    }

    const file = await Deno.readFile(path);
    return new Response(file, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache, no-store, must-revalidate" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
