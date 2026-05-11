import { AxiomConfig, QueuedRequest, RequestPriority } from '../types';
import { AxiomStorageAdapter } from '../adapters';
import { MemoryStorageAdapter } from '../adapters/memory';
import { SyncManager } from './sync';

export class AxiomEngine {
  private config: AxiomConfig = {};
  private storage: AxiomStorageAdapter = new MemoryStorageAdapter(); 
  private syncManager!: SyncManager;

  /**
   * Initializes the Axiom engine with your specific rules and storage.
   */
  public create(config: AxiomConfig, storageAdapter?: AxiomStorageAdapter): void {
    this.config = config;
    if (storageAdapter) {
      this.storage = storageAdapter;
    }

    this.syncManager = new SyncManager(this.storage, this.config);
  }

  public async forceSync(): Promise<void> {
    if (!this.syncManager) {
      console.error("[Axiom] Engine not initialized. Call axiom.create() first.");
      return;
    }
    await this.syncManager.flushQueue();
  }

  /**
   * Generates a unique ID for queued requests.
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  /**
   * The core POST method. Designed to feel exactly like Axios.
   */
  public async post<T>(
    url: string, 
    data?: any, 
    options?: { priority?: RequestPriority }
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    
    const request: QueuedRequest = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.defaultHeaders || {})
      },
      body: data ? JSON.stringify(data) : undefined,
      priority: options?.priority || 'urgent',
      retryCount: 0
    };

    return this.attemptFetch<T>(request);
  }

  /**
   * Internal logic to fire the request or catch the network drop.
   */
  private async attemptFetch<T>(request: QueuedRequest): Promise<{ data?: T; status: number; isQueued: boolean }> {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

      if (response.ok) {
        const responseData = await response.json().catch(() => null);
        return { data: responseData, status: response.status, isQueued: false };
      }


      if (response.status >= 500) {
        throw new Error('Server Error');
      }


      return { status: response.status, isQueued: false };

    } catch (error) {
      await this.enqueueRequest(request);

      return { status: 202, isQueued: true };
    }
  }

  /**
   * Saves the request to whatever storage adapter was provided on startup.
   */
  private async enqueueRequest(request: QueuedRequest): Promise<void> {
    console.warn(`[Axiom] Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
  }
}

export const axiom = new AxiomEngine();