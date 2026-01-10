/**
 * Centralized reload management
 * Handles deferred reloads when tasks are running
 */

export type BroadcastFn = (message: any) => void;

export class ReloadManager {
  private broadcastFn: BroadcastFn | null = null;
  private pendingReload = false;
  private pendingReason: string | null = null;
  private taskRunning = false;

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
    if (this.taskRunning) {
      console.log(`⏸️  Deferring reload: ${reason}`);
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
      console.log(`🔄 Triggering reload: ${reloadReason}`);

      this.broadcastFn({
        type: "reload_page",
        reason: reloadReason
      });
    }

    this.pendingReload = false;
    this.pendingReason = null;
  }
}
