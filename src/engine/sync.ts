import { AxiomStorageAdapter } from '../adapters';
import { AxiomConfig, QueuedRequest } from '../types';

export class SyncManager {
  private isSyncing = false;

  constructor(
    private storage: AxiomStorageAdapter,
    private config: AxiomConfig
  ) {}

  /**
   * The master trigger. Call this when the OS reports network is back online.
   */
  public async flushQueue(): Promise<void> {
    // Prevent overlapping syncs if the network toggles rapidly
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const pending = await this.storage.getAll();
      
      if (pending.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[Axiom] Network restored. Syncing ${pending.length} queued requests...`);

      // We process sequentially to maintain the order of user actions
      for (const request of pending) {
        await this.processRequest(request);
      }
      
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Attempts to execute a single saved request.
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    let reqToSync = request;

    // MITIGATION 1: Just-in-Time Headers (Refresh Auth Tokens)
    if (this.config.onBeforeSync) {
      try {
        reqToSync = await this.config.onBeforeSync(request);
      } catch (error) {
        console.error(`[Axiom] onBeforeSync failed for ${request.id}. Skipping.`);
        return; 
      }
    }

    try {
      const response = await fetch(reqToSync.url, {
        method: reqToSync.method,
        headers: reqToSync.headers,
        body: reqToSync.body
      });

      // If it's a success OR a permanent 400 error (like bad data), remove it.
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await this.storage.remove(reqToSync.id);
        console.log(`[Axiom] Request ${reqToSync.id} synced successfully.`);
      } else {
        // It's a 500 Server Error. Treat as a failure and retry later.
        await this.handleFailure(reqToSync);
      }
    } catch (error) {
      // Network dropped again mid-sync.
      await this.handleFailure(reqToSync);
    }
  }

  /**
   * MITIGATION 2: The Dead Letter Queue logic
   */
  private async handleFailure(request: QueuedRequest): Promise<void> {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries || 3;

    if (request.retryCount >= maxRetries) {
      console.warn(`[Axiom] Request ${request.id} failed ${maxRetries} times. Moving to Dead Letter.`);
      await this.storage.remove(request.id);
      
      if (this.config.onDeadLetter) {
        this.config.onDeadLetter(request, new Error('Max retries exceeded'));
      }
    } else {
      // Save the updated retry count back to storage
      await this.storage.save(request);
    }
  }
}