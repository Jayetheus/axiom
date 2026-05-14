import type { AxiomConfig, AxiomStorageAdapter, QueuedRequest } from "../types";

type SyncOutcome = "success" | "permanent-failure" | "transient-failure";

type EngineLike = {
  emit: (...args: any[]) => void;
  log: (...args: any[]) => void;
};

export class SyncManager {
  private isSyncing = false;

  constructor(
    private storage: AxiomStorageAdapter,
    private config: AxiomConfig,
    private engine: EngineLike,
  ) {}

  public updateConfig(config: AxiomConfig): void {
    this.config = config;
  }

  /**
   * Call this when the runtime reports connectivity is available again.
   * Requests are replayed sequentially with batching and retry backoff.
   */
  public async flushQueue(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const now = Date.now();
      const pending = await this.storage.getAll();
      const batchSize = this.config.syncBatchSize ?? 10;

      const eligible = pending
        .filter((request) => !request.nextRetryAt || request.nextRetryAt <= now)
        .sort((a, b) => {
          if (a.priority === "urgent" && b.priority !== "urgent") return -1;
          if (a.priority !== "urgent" && b.priority === "urgent") return 1;
          return a.timestamp - b.timestamp;
        })
        .slice(0, batchSize);

      if (eligible.length === 0) {
        return;
      }

      this.engine.log(
        "info",
        `Syncing ${eligible.length} queued request(s) out of ${pending.length} pending.`,
      );

      for (const request of eligible) {
        const outcome = await this.processRequest(request);
        if (outcome === "transient-failure") {
          break;
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private calculateNextRetryAt(retryCount: number): number {
    const baseDelay = this.config.retryBaseDelayMs ?? 1000;
    const maxDelay = this.config.retryMaxDelayMs ?? 30000;
    const jitterRatio = this.config.retryJitter ?? 0.2;
    const exponentialDelay = Math.min(
      maxDelay,
      baseDelay * 2 ** Math.max(retryCount - 1, 0),
    );
    const jitter = Math.round(exponentialDelay * jitterRatio * Math.random());
    return Date.now() + exponentialDelay + jitter;
  }

  private async processRequest(request: QueuedRequest): Promise<SyncOutcome> {
    let reqToSync = request;

    if (this.config.onBeforeSync) {
      try {
        reqToSync = await this.config.onBeforeSync(request);
      } catch (error) {
        return this.handleFailure(
          request,
          error instanceof Error ? error : new Error("onBeforeSync failed"),
          null,
        );
      }
    }

    const controller = new AbortController();
    const timeoutMs = reqToSync.timeoutMs || this.config.timeout || 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    this.engine.emit("syncStart", request);

    try {
      const response = await fetch(reqToSync.url, {
        method: reqToSync.method,
        headers: reqToSync.headers,
        body: reqToSync.body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const responseData = await response.json().catch(() => null);

        if (this.config.onResponse) {
          await this.config.onResponse(
            responseData,
            response.status,
            reqToSync,
          );
        }

        await this.storage.remove(request.id);
        this.engine.log("info", `Request ${request.id} synced successfully.`);
        this.engine.emit("syncSuccess", {
          request: reqToSync,
          response: responseData,
        });
        return "success";
      }

      const error = new Error(
        response.status >= 500
          ? `Server Error: ${response.status}`
          : `Client Error: ${response.status}`,
      );

      if (this.config.onError) {
        await this.config.onError(response.status, error, reqToSync);
      }

      if (response.status >= 400 && response.status < 500) {
        return this.moveToDeadLetter(
          reqToSync,
          request.id,
          error,
          response.status,
        );
      }

      return this.handleFailure(request, error, response.status);
    } catch (error: any) {
      clearTimeout(timeoutId);

      const normalizedError =
        error instanceof Error ? error : new Error("Network failure");

      if (this.config.onError) {
        await this.config.onError(null, normalizedError, reqToSync);
      }

      return this.handleFailure(request, normalizedError, null);
    }
  }

  private async handleFailure(
    request: QueuedRequest,
    error: Error,
    status: number | null,
  ): Promise<SyncOutcome> {
    const nextRetryCount = request.retryCount + 1;
    const maxRetries = this.config.maxRetries ?? 3;

    if (nextRetryCount >= maxRetries) {
      return this.moveToDeadLetter(
        { ...request, retryCount: nextRetryCount, lastError: error.message },
        request.id,
        error,
        status,
      );
    }

    const nextRetryAt = this.calculateNextRetryAt(nextRetryCount);
    const retryableRequest: QueuedRequest = {
      ...request,
      retryCount: nextRetryCount,
      nextRetryAt,
      lastError: error.message,
    };

    await this.storage.save(retryableRequest);
    this.engine.emit("syncFailure", {
      request: retryableRequest,
      status,
      error,
      willRetry: true,
      nextRetryAt,
    });

    return "transient-failure";
  }

  private async moveToDeadLetter(
    request: QueuedRequest,
    storageId: string,
    error: Error,
    status: number | null,
  ): Promise<SyncOutcome> {
    this.engine.log(
      "warn",
      `Request ${storageId} moved to dead letters: ${error.message}.`,
    );

    await this.storage.remove(storageId);
    await this.storage.saveDeadLetter?.(request);

    if (this.config.onDeadLetter) {
      await this.config.onDeadLetter(request, error);
    }

    this.engine.emit("syncFailure", {
      request,
      status,
      error,
      willRetry: false,
    });
    this.engine.emit("deadLetter", request);
    return "permanent-failure";
  }
}
