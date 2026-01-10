/**
 * File watcher for hot reload
 * Watches ./client directory for changes and triggers transpilation/reload
 */

import { log, error } from "./logger.ts";
import { transpileFile } from "./transpile.ts";
import type { ReloadManager } from "./reload-manager.ts";
import type { BroadcastFn } from "./agent-context.ts";

/**
 * Setup file watcher for client directory
 * Returns the watcher instance for cleanup
 */
export function setupFileWatcher(
  reloadManager: ReloadManager,
  broadcast: BroadcastFn
): Deno.FsWatcher | null {
  try {
    const fileWatcher = Deno.watchFs("./client");

    (async () => {
      for await (const event of fileWatcher) {
        if (event.kind === "modify") {
          const changedPath = event.paths[0];
          const changedFile = changedPath.split('/').pop();

          // TypeScript files: transpile first, then reload via callback
          if (changedPath.endsWith('.ts')) {
            log(`TypeScript file changed: ${changedFile}, triggering transpilation`);

            try {
              // Trigger proactive transpilation
              // The transpile callback will handle broadcasting reload
              await transpileFile(changedPath);
            } catch (err) {
              error(`Transpilation failed for ${changedFile}:`, err);

              // Broadcast error to clients (don't reload on error!)
              broadcast({
                type: "system",
                content: `TypeScript error in ${changedFile}: ${err instanceof Error ? err.message : String(err)}`,
                level: "error"
              });
            }
          }
          // Non-TypeScript files: request reload (reloadManager handles deferral)
          else if (changedPath.endsWith('.css') ||
                   changedPath.endsWith('.html') ||
                   changedPath.endsWith('.js')) {
            log(`Client file changed: ${changedFile}`);
            reloadManager.requestReload(`Client file updated: ${changedFile}`);
          }
        }
      }
    })().catch(err => {
      error("File watcher error:", err);
    });

    return fileWatcher;
  } catch (err) {
    error("Failed to setup file watcher:", err);
    return null;
  }
}
