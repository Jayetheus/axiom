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
   * Automatically sorts requests so 'urgent' items bypass 'background' items.
   */
  public async flushQueue(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const pending = await this.storage.getAll();
      
      if (pending.length === 0) {
        return;
      }

      console.log(`[Axiom] Network restored. Syncing ${pending.length} queued requests...`);

      // MITIGATION 3: Priority Lanes (Urgent requests jump the line)
      // If priorities match, it falls back to timestamp (FIFO) to maintain action order.
      const sortedQueue = pending.sort((a, b) => {
        if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
        if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
        return a.timestamp - b.timestamp;
      });

      for (const request of sortedQueue) {
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
        console.error(`[Axiom] onBeforeSync failed for ${request.id}. Marking as failure.`);
        await this.handleFailure(request); // FIX: Ensure we increment retry count if this fails
        return; 
      }
    }

    // Apply the global timeout to background syncing as well
    const controller = new AbortController();
    const timeoutMs = this.config.timeout || 10000; // Default 10s for background syncs
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(reqToSync.url, {
        method: reqToSync.method,
        headers: reqToSync.headers,
        body: reqToSync.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // If it's a success OR a permanent 400 error (like bad data), remove it.
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        await this.storage.remove(reqToSync.id);
        console.log(`[Axiom] Request ${reqToSync.id} synced successfully.`);
      } else {
        // It's a 500 Server Error. Treat as a failure and retry later.
        await this.handleFailure(reqToSync);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      // Network dropped again mid-sync or timeout was reached.
      await this.handleFailure(reqToSync);
    }
  }

  /**
   * MITIGATION 2: The Dead Letter Queue logic
   */
  private async handleFailure(request: QueuedRequest): Promise<void> {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries ?? 3; // Use nullish coalescing so 0 is valid

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