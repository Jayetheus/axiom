import type {
  AxiomConfig,
  AxiomEvent,
  AxiomRequestOptions,
  AxiomStorageAdapter,
  QueuedRequest,
  SyncFailureEvent,
  SyncSuccessEvent,
} from "../types";
import { MemoryStorageAdapter } from "../adapters/memory";
import { SyncManager } from "./sync";
import { resolveStorageAdapter } from "../adapters/resolver";

type AxiomEventPayloads = {
  syncStart: QueuedRequest;
  syncSuccess: SyncSuccessEvent;
  syncFailure: SyncFailureEvent;
  deadLetter: QueuedRequest;
  requestCancelled: string;
};

type AxiomEventListener<TEvent extends AxiomEvent> = (
  payload: AxiomEventPayloads[TEvent],
) => void;

export class AxiomEngine {
  private config: AxiomConfig = {};
  private storage: AxiomStorageAdapter = new MemoryStorageAdapter();
  private syncManager?: SyncManager;
  private listeners: Map<AxiomEvent, Set<(...args: any[]) => void>> = new Map();
  private resolvedAdapterPreference: AxiomConfig["fallbackAdapter"] = "memory";
  private scheduledSyncTimer?: ReturnType<typeof setTimeout>;
  private isOnline = true;

  /** Internal verbose logger */
  public log(...args: any[]): void {
    if (!this.config.debug) return;

    if (args[0] === "error") {
      console.error("[Axiom Error]", ...args.slice(1));
    } else if (args[0] === "warn") {
      console.warn("[Axiom Warn]", ...args.slice(1));
    } else if (args[0] === "info") {
      console.info("[Axiom Info]", ...args.slice(1));
    } else {
      console.log("[Axiom Debug]", ...args);
    }
  }

  /** Registers an event listener for Axiom lifecycle events. */
  public on<TEvent extends AxiomEvent>(
    event: TEvent,
    listener: AxiomEventListener<TEvent>,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (...args: any[]) => void);
  }

  /** Unregisters a previously registered event listener. */
  public off<TEvent extends AxiomEvent>(
    event: TEvent,
    listener: AxiomEventListener<TEvent>,
  ): void {
    this.listeners.get(event)?.delete(listener as (...args: any[]) => void);
  }

  /** Internal method to emit events to registered listeners. */
  public emit<TEvent extends AxiomEvent>(
    event: TEvent,
    payload: AxiomEventPayloads[TEvent],
  ): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }

  /** Initializes Axiom with global configuration and a storage adapter. */
  public create(
    config: AxiomConfig,
    storageAdapter?: AxiomStorageAdapter,
  ): void {
    const previousStorage = this.storage;

    if (storageAdapter) {
      this.storage = storageAdapter;
      this.resolvedAdapterPreference = undefined;
      this.log("info", "Custom storage adapter injected manually.");
    } else {
      const fallback = config.fallbackAdapter || "memory";
      if (!this.syncManager || fallback !== this.resolvedAdapterPreference) {
        this.storage = resolveStorageAdapter(fallback, !!config.debug);
        this.resolvedAdapterPreference = fallback;
      }
    }

    this.config = config;

    const storageChanged = previousStorage !== this.storage;

    if (!this.syncManager || storageChanged) {
      this.syncManager = new SyncManager(this.storage, this.config, this);
    } else {
      this.syncManager.updateConfig(this.config);
    }

    void this.scheduleNextSyncFromQueue();
    this.log("info", "Engine initialized.");
  }

  /** Updates runtime config without recreating storage adapters or listeners. */
  public updateConfig(config: AxiomConfig): void {
    this.config = config;
    this.syncManager?.updateConfig(config);
    void this.scheduleNextSyncFromQueue();
  }

  /** Updates the engine's view of network availability. */
  public setOnlineStatus(isOnline: boolean): void {
    this.isOnline = isOnline;

    if (isOnline) {
      void this.forceSync();
      return;
    }

    this.clearScheduledSync();
  }

  /** Manually triggers the background sync manager to flush pending queued requests. */
  public async forceSync(): Promise<void> {
    if (!this.syncManager) {
      this.log("error", "Engine not initialized. Call axiom.create() first.");
      return;
    }

    if (!this.isOnline) {
      await this.scheduleNextSyncFromQueue();
      return;
    }

    await this.syncManager.flushQueue();
    await this.scheduleNextSyncFromQueue();
  }

  /** Retrieves all currently queued requests from storage. */
  public async getQueue(): Promise<QueuedRequest[]> {
    return this.storage.getAll();
  }

  /** Retrieves all persisted dead letters from storage. */
  public async getDeadLetters(): Promise<QueuedRequest[]> {
    return (await this.storage.getDeadLetters?.()) || [];
  }

  /** Clears all persisted dead letters. */
  public async clearDeadLetters(): Promise<void> {
    await this.storage.clearDeadLetters?.();
  }

  /** Cancels and removes a specific request from the pending queue by its ID. */
  public async cancelRequest(id: string): Promise<void> {
    await this.storage.remove(id);
    this.log("info", `Cancelled queued request ${id}`);
    this.emit("requestCancelled", id);
    await this.scheduleNextSyncFromQueue();
  }

  private clearScheduledSync(): void {
    if (this.scheduledSyncTimer) {
      clearTimeout(this.scheduledSyncTimer);
      this.scheduledSyncTimer = undefined;
    }
  }

  private async scheduleNextSyncFromQueue(): Promise<void> {
    this.clearScheduledSync();

    const queue = await this.storage.getAll();
    const now = Date.now();
    const nextRetryAt = queue.reduce<number | undefined>((nearest, request) => {
      if (!request.nextRetryAt || request.nextRetryAt <= now) {
        return nearest;
      }

      if (nearest === undefined || request.nextRetryAt < nearest) {
        return request.nextRetryAt;
      }

      return nearest;
    }, undefined);

    if (nextRetryAt === undefined || !this.isOnline) {
      return;
    }

    const delay = Math.max(nextRetryAt - now, 0);
    this.scheduledSyncTimer = setTimeout(() => {
      this.scheduledSyncTimer = undefined;
      void this.forceSync();
    }, delay);
  }

  private generateId(): string {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  private hash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  private createAutoIdempotencyKey(
    method: QueuedRequest["method"],
    url: string,
    body?: string,
  ): string {
    const entropy = this.generateId();
    return `axm_${method.toLowerCase()}_${this.hash(`${url}:${body || ""}`)}_${entropy}`;
  }

  private buildDedupeKey(
    method: QueuedRequest["method"],
    url: string,
    body?: string,
    idempotencyKey?: string,
  ): string {
    if (idempotencyKey) {
      return `idem:${idempotencyKey}`;
    }

    return `fp:${method}:${url}:${this.hash(body || "")}`;
  }

  public async get<T>(
    url: string,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>("GET", url, undefined, options);
  }

  public async post<T>(
    url: string,
    data?: any,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>("POST", url, data, options);
  }

  public async put<T>(
    url: string,
    data?: any,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>("PUT", url, data, options);
  }

  public async patch<T>(
    url: string,
    data?: any,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>("PATCH", url, data, options);
  }

  public async delete<T>(
    url: string,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    return this.prepareRequest<T>("DELETE", url, undefined, options);
  }

  private async prepareRequest<T>(
    method: QueuedRequest["method"],
    url: string,
    data?: any,
    options?: AxiomRequestOptions,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    const body = data === undefined ? undefined : JSON.stringify(data);
    const timeoutMs = options?.timeout || this.config.timeout || 8000;

    const headers: Record<string, string> = {
      ...(this.config.defaultHeaders || {}),
      ...(options?.headers || {}),
    };

    if (body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const shouldQueue = isMutation || !!this.config.queueReads;
    let idempotencyKey = options?.idempotencyKey;

    if (isMutation) {
      if (!idempotencyKey && this.config.generateIdempotencyKey) {
        idempotencyKey = this.config.generateIdempotencyKey({
          url: fullUrl,
          method,
          headers,
          body,
          metadata: options?.metadata,
        });
      }

      if (!idempotencyKey && this.config.autoIdempotency !== false) {
        idempotencyKey = this.createAutoIdempotencyKey(method, fullUrl, body);
      }

      if (idempotencyKey) {
        const headerName =
          this.config.idempotencyHeaderName || "Idempotency-Key";
        headers[headerName] = idempotencyKey;
      } else if (this.config.warnOnMissingIdempotency) {
        this.log(
          "warn",
          `Missing Idempotency-Key for ${method} request to ${url}.`,
        );
      }
    }

    const request: QueuedRequest = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method,
      headers,
      body,
      priority: options?.priority || "urgent",
      retryCount: 0,
      timeoutMs,
      idempotencyKey,
      dedupeKey: this.buildDedupeKey(method, fullUrl, body, idempotencyKey),
      metadata: options?.metadata,
    };

    return this.attemptFetch<T>(request, timeoutMs, shouldQueue);
  }

  private async attemptFetch<T>(
    request: QueuedRequest,
    timeoutMs: number,
    shouldQueue: boolean,
  ): Promise<{ data?: T; status: number; isQueued: boolean }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const responseData = await response.json().catch(() => null);

        if (this.config.onResponse) {
          await this.config.onResponse(responseData, response.status, request);
        }

        return { data: responseData, status: response.status, isQueued: false };
      }

      if (this.config.onError) {
        await this.config.onError(
          response.status,
          new Error(
            response.status >= 500
              ? `Server Error: ${response.status}`
              : `Client Error: ${response.status}`,
          ),
          request,
        );
      }

      if (response.status >= 500 && shouldQueue) {
        await this.enqueueRequest({
          ...request,
          lastError: `HTTP ${response.status}`,
        });
        return { status: 202, isQueued: true };
      }

      return { status: response.status, isQueued: false };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (this.config.onError) {
        await this.config.onError(null, error, request);
      }

      if (!shouldQueue) {
        return { status: 0, isQueued: false };
      }

      if (error?.name === "AbortError") {
        this.log(
          "warn",
          `Request to ${request.url} timed out after ${timeoutMs}ms. Queuing for retry.`,
        );
      }

      await this.enqueueRequest({
        ...request,
        lastError: error instanceof Error ? error.message : "Network failure",
      });

      return { status: 202, isQueued: true };
    }
  }

  private async enqueueRequest(request: QueuedRequest): Promise<void> {
    const pending = await this.storage.getAll();
    const duplicate = pending.find(
      (queued) =>
        queued.dedupeKey &&
        request.dedupeKey &&
        queued.dedupeKey === request.dedupeKey,
    );

    if (duplicate) {
      this.log(
        "info",
        `Dropping duplicate queued request ${request.id} in favor of ${duplicate.id}.`,
      );
      return;
    }

    this.log("warn", `Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
    await this.scheduleNextSyncFromQueue();
  }
}

export const axiom = new AxiomEngine();
