import { AxiomConfig, AxiomRequestOptions, QueuedRequest, RequestPriority } from '../types';
import { AxiomStorageAdapter } from '../adapters';
import { MemoryStorageAdapter } from '../adapters/memory';
import { SyncManager } from './sync';
import { resolveStorageAdapter } from '../adapters/resolver';

type AxiomEvent = 'syncStart' | 'syncSuccess' | 'syncError' | 'deadLetter';
type AxiomEventListener = (...args: any[]) => void;

export class AxiomEngine {
  private config: AxiomConfig = {};
  private storage: AxiomStorageAdapter = new MemoryStorageAdapter(); 
  private syncManager!: SyncManager;
  private listeners: Map<AxiomEvent, Set<AxiomEventListener>> = new Map();

  /** Internal verbose logger */
  public log(...args: any[]): void {
    if (this.config.debug) {

      if(args[0] === 'error') {
        console.error('🔴 [Axiom Error]', ...args);
      } else if(args[0] === 'warn') {
        console.warn('🟠 [Axiom Warn]', ...args);
      } else if(args[0] === 'info') {
        console.info('🔵 [Axiom Info]', ...args);
      } else {
        console.log('⚪ [Axiom Debug]', ...args);
      }
    }
  }

  /** Registers an event listener for Axiom lifecycle events (e.g., sync attempts, successes, failures). */
  public on(event: AxiomEvent, listener: AxiomEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  /** Unregisters a previously registered event listener. */
  public off(event: AxiomEvent, listener: AxiomEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Internal method to emit events to registered listeners. */
  public emit(event: AxiomEvent, ...args: any[]): void {
    this.listeners.get(event)?.forEach(listener => listener(...args));
  }

  /**
   * Initializes the Axiom engine with global configuration and a storage adapter.
   * This must be called before making any requests to enable persistence.
   * * @param config - Global configuration (baseURL, timeouts, custom headers, etc.)
   * @param storageAdapter - Optional custom adapter (e.g., MMKV). Defaults to in-memory storage.
   */
public create(config: AxiomConfig, storageAdapter?: AxiomStorageAdapter): void {
    this.config = config;
    
    if (this.config.debug) this.log("info","Engine initializing with config:", config);

    if (storageAdapter) {
      this.storage = storageAdapter;
      this.log("info","Custom storage adapter injected manually.");
    } else {
      const fallback = config.fallbackAdapter || 'memory';
      this.storage = resolveStorageAdapter(fallback, !!config.debug);
    }

    this.syncManager = new SyncManager(this.storage, this.config, this);
  }

  /**
   * Manually triggers the background sync manager to flush all pending queued requests.
   * Note: This is automatically handled by `AxiomProvider` when the network reconnects.
   */
  public async forceSync(): Promise<void> {
    if (!this.syncManager) {
      this.log("error","[Axiom] Engine not initialized. Call axiom.create() first.");
      return;
    }
    await this.syncManager.flushQueue();
  }

  /**
   * Generates a unique collision-resistant ID for queued requests.
   */
  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  /**
   * Executes an HTTP GET request. 
   * If the network is unavailable or times out, the request is safely queued.
   * * @param url - The endpoint URL (appended to baseURL if configured).
   * @param options - Request-specific options (priority lanes, timeout overrides).
   * @returns A promise resolving to the response data, status code, and queue state.
   */
  public async get<T>(
    url: string, 
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>('GET', url, undefined, options);
  }

  /**
   * Executes an HTTP POST request.
   * If the network is unavailable or times out, the payload is safely queued.
   * * @param url - The endpoint URL.
   * @param data - The payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  public async post<T>(
    url: string, 
    data?: any, 
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>('POST', url, data, options);
  }

  /**
   * Executes an HTTP PUT request to entirely replace a resource.
   * * @param url - The endpoint URL.
   * @param data - The payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  public async put<T>(
    url: string, 
    data?: any, 
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>('PUT', url, data, options);
  }

  /**
   * Executes an HTTP PATCH request to partially update a resource.
   * * @param url - The endpoint URL.
   * @param data - The partial payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  public async patch<T>(
    url: string, 
    data?: any, 
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>('PATCH', url, data, options);
  }

  /**
   * Executes an HTTP DELETE request.
   * * @param url - The endpoint URL.
   * @param options - Request-specific options.
   */
  public async delete<T>(
    url: string, 
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>('DELETE', url, undefined, options);
  }

  /**
   * Internal helper to consolidate request preparation and keep the engine DRY.
   */
  private async prepareRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    options?: AxiomRequestOptions
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    
    const headers: Record<string, string> = { ...(this.config.defaultHeaders || {}) };
    if (options?.headers) Object.assign(headers, options.headers);
    if (data) headers['Content-Type'] = 'application/json';
    
    const request: QueuedRequest = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      priority: options?.priority || 'urgent',
      retryCount: 0,
      metadata: options?.metadata 
    };

    const timeoutMs = options?.timeout || this.config.timeout || 8000;
    return this.attemptFetch<T>(request, timeoutMs);
  }


 /**
   * Internal logic to fire the request or catch the network drop.
   * Handles timeout cancellations and triggers Global Interceptors.
   */
  private async attemptFetch<T>(request: QueuedRequest, timeoutMs: number): Promise<{ data?: T; status: number; isQueued: boolean }> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const responseData = await response.json().catch(() => null);
        
        if (this.config.onResponse) {
          await this.config.onResponse(responseData, response.status, request);
        }
        
        return { data: responseData, status: response.status, isQueued: false };
      }

      if (response.status >= 400 && response.status < 500) {
        if (this.config.onError) {
          await this.config.onError(response.status, new Error(`Client Error: ${response.status}`), request);
        }
        return { status: response.status, isQueued: false };
      }

      if (response.status >= 500) {
        if (this.config.onError) {
          await this.config.onError(response.status, new Error(`Server Error: ${response.status}`), request);
        }
        await this.enqueueRequest(request);
        return { status: 202, isQueued: true };
      }

      return { status: response.status, isQueued: false };

    } catch (error: any) {
        clearTimeout(timeoutId);

        if(error.name === 'AbortError') {
          console.warn(`[Axiom] Request to ${request.url} timed out after ${timeoutMs}ms. Queuing for retry.`);
        }
        
        // 4. NETWORK DROP / TIMEOUT: Status is null because it never reached the server
        if (this.config.onError) {
          await this.config.onError(null, error, request);
        }
        
        await this.enqueueRequest(request);

        return { status: 202, isQueued: true };
    }
  }

  /**
   * Saves the request to the configured storage adapter.
   */
  private async enqueueRequest(request: QueuedRequest): Promise<void> {
    this.log(`Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
  }
}

export const axiom = new AxiomEngine();