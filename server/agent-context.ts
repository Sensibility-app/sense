/**
 * Agent execution context
 * Manages task lifecycle, stop requests, and integration with reload manager
 */

import { log } from "./logger.ts";
import type { ReloadManager } from "./reload-manager.ts";

export type BroadcastFn = (message: any) => void;

/**
 * Agent execution context - manages task lifecycle and stop requests
 */
export class AgentContext {
  private stopRequested = false;
  private runningTask: Promise<void> | null = null;
  private broadcastFn: BroadcastFn | null = null;
  private reloadManager: ReloadManager | null = null;

  /**
   * Set broadcast function for sending messages to clients
   */
  setBroadcast(broadcast: BroadcastFn): void {
    this.broadcastFn = broadcast;
  }

  /**
   * Set reload manager for handling page reloads
   */
  setReloadManager(manager: ReloadManager): void {
    this.reloadManager = manager;
  }

  /**
   * Check if agent is currently running
   */
  isRunning(): boolean {
    return this.runningTask !== null;
  }

  /**
   * Request agent to stop gracefully
   */
  requestStop(): void {
    this.stopRequested = true;
    log("🛑 Stop requested");
  }

  /**
   * Check if stop was requested
   */
  shouldStop(): boolean {
    return this.stopRequested;
  }

  /**
   * Execute an agent task with automatic lifecycle management
   */
  async execute(
    taskFn: (shouldStop: () => boolean) => Promise<void>
  ): Promise<void> {
    if (this.runningTask) {
      throw new Error("Agent already running");
    }

    this.stopRequested = false;

    try {
      if (this.broadcastFn) {
        this.broadcastFn({ type: "processing_status", isProcessing: true });
      }

      // Notify reload manager that task is starting
      if (this.reloadManager) {
        this.reloadManager.setTaskRunning(true);
      }

      this.runningTask = taskFn(() => this.shouldStop());
      await this.runningTask;
    } finally {
      this.runningTask = null;
      this.stopRequested = false;

      if (this.broadcastFn) {
        this.broadcastFn({ type: "processing_status", isProcessing: false });
      }

      // Notify reload manager that task is complete
      if (this.reloadManager) {
        this.reloadManager.setTaskRunning(false);
      }
    }
  }
}
