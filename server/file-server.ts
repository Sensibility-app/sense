/**
 * Static file serving with TypeScript transpilation
 */

import { transpileFile } from "./transpile.ts";
import { mapJsToTs } from "./tools/_shared/sanitize.ts";

/**
 * Serve static files with automatic TypeScript transpilation
 */
export async function serveStaticFile(
  pathname: string,
  onTranspileCallback?: (filepath: string, fromCache: boolean) => void
): Promise<Response> {
  // Intercept /client/*.js to serve transpiled TypeScript modules
  if (pathname.startsWith("/client/") && pathname.endsWith(".js")) {
    try {
      // Map .js to .ts file (e.g., /client/client.js -> ./client/client.ts)
      const tsPath = `.${mapJsToTs(pathname)}`;

      // Transpile TypeScript to JavaScript
      const { code, fromCache } = await transpileFile(tsPath);

      // Notify callback if provided
      if (onTranspileCallback) {
        onTranspileCallback(tsPath, fromCache);
      }

      return new Response(code, {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    } catch (err) {
      console.error("Transpilation error:", err);
      return new Response(`// Transpilation error: ${err instanceof Error ? err.message : String(err)}`, {
        status: 500,
        headers: {
          "Content-Type": "text/javascript",
        },
      });
    }
  }

  // Serve static files
  const path = pathname === "/" ? "/client/index.html" : pathname;
  return serveFile(`.${path}`);
}

/**
 * Serve a static file from the filesystem
 */
async function serveFile(path: string): Promise<Response> {
  try {
    const ext = path.split(".").pop();
    const contentType = ext === "html"
      ? "text/html"
      : ext === "js"
      ? "text/javascript"
      : ext === "css"
      ? "text/css"
      : ext === "json"
      ? "application/json"
      : ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "svg"
      ? "image/svg+xml"
      : ext === "ico"
      ? "image/x-icon"
      : "text/plain";

    // For HTML files: rewrite .ts script references to .js
    if (ext === "html") {
      const html = await Deno.readTextFile(path);
      // Replace <script ... src="/client/something.ts"> with .js
      // Matches: <script ... src="path.ts"> and replaces .ts with .js
      const rewritten = html.replace(
        /(<script[^>]+src=["'])([^"']+)\.ts(["'][^>]*>)/g,
        '$1$2.js$3'
      );

      return new Response(rewritten, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-cache, no-store, must-revalidate", // Always fresh in dev
          "Pragma": "no-cache",
          "Expires": "0"
        },
      });
    }

    // For other files: serve as-is with no-cache headers in dev
    const file = await Deno.readFile(path);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate", // Always fresh in dev
        "Pragma": "no-cache",
        "Expires": "0"
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
