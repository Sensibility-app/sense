/**
 * Centralized reload management
 * Handles deferred reloads when tasks are running
 */

import { log } from "./logger.ts";

export type BroadcastFn = (message: any) => void;

export class ReloadManager {
  private broadcastFn: BroadcastFn | null = null;
  private pendingReload = false;
  private pendingReason: string | null = null;
  private taskRunning = false;
  private startupTime: number = Date.now();
  private STARTUP_GRACE_PERIOD_MS = 15000; // 15 seconds after startup, ignore reloads (iOS needs more time)

  /**
   * Set broadcast function for sending messages to clients
   */
  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn;
  }

  /**
   * Update task running state
   * If task completes and reload is pending, trigger it
   */
  setTaskRunning(running: boolean): void {
    const wasRunning = this.taskRunning;
    this.taskRunning = running;

    // Task just completed - trigger pending reload if any
    if (wasRunning && !running && this.pendingReload) {
      setTimeout(() => this.triggerReload(), 100);
    }
  }

  /**
   * Request a page reload (will be deferred if task is running)
   */
  requestReload(reason: string): void {
    // Ignore reloads during startup grace period (prevents reload loops on initial load)
    const timeSinceStartup = Date.now() - this.startupTime;
    if (timeSinceStartup < this.STARTUP_GRACE_PERIOD_MS) {
      log(`Ignoring reload during startup grace period: ${reason} (${timeSinceStartup}ms since startup)`);
      return;
    }

    if (this.taskRunning) {
      log(`Deferring reload: ${reason}`);
      this.pendingReload = true;
      this.pendingReason = reason;

      // Notify clients
      if (this.broadcastFn) {
        this.broadcastFn({
          type: "system",
          content: `${reason} - page will reload after task completes`,
          level: "info"
        });
      }
    } else {
      this.triggerReload(reason);
    }
  }

  /**
   * Trigger immediate page reload
   */
  private triggerReload(reason?: string): void {
    if (this.broadcastFn) {
      const reloadReason = reason || this.pendingReason || "Server code changed";
      log(`Triggering reload: ${reloadReason}`);

      this.broadcastFn({
        type: "reload_page",
        reason: reloadReason
      });
    }

    this.pendingReload = false;
    this.pendingReason = null;
  }
}
