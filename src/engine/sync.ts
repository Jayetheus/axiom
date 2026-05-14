import { AxiomStorageAdapter } from "../adapters";
import { AxiomConfig, QueuedRequest } from "../types";

export class SyncManager {
  private isSyncing = false;

  constructor(
    private storage: AxiomStorageAdapter,
    private config: AxiomConfig,
    private engine: any,
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

      console.log(
        `[Axiom] Network restored. Syncing ${pending.length} queued requests...`,
      );

      const sortedQueue = pending.sort((a, b) => {
        if (a.priority === "urgent" && b.priority !== "urgent") return -1;
        if (a.priority !== "urgent" && b.priority === "urgent") return 1;
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

    if (this.config.onBeforeSync) {
      try {
        reqToSync = await this.config.onBeforeSync(request);
      } catch (error) {
        this.engine.log(
          "error",
          `onBeforeSync failed for ${request.id}. Marking as failure.`,
        );
        await this.handleFailure(request);
        return;
      }
    }

    const controller = new AbortController();
    const timeoutMs = this.config.timeout || 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

        await this.storage.remove(reqToSync.id);
        this.engine.log("info", `Request ${reqToSync.id} synced successfully.`);
        this.engine.emit("syncSuccess", {
          request: reqToSync,
          response: responseData,
        });
      } else if (response.status >= 400 && response.status < 500) {
        if (this.config.onError) {
          await this.config.onError(
            response.status,
            new Error(`Client Error: ${response.status}`),
            reqToSync,
          );
        }
        await this.storage.remove(reqToSync.id);
        this.engine.emit("syncFailure", {
          request: reqToSync,
          status: response.status,
        });
      } else {
        if (this.config.onError) {
          await this.config.onError(
            response.status,
            new Error(`Server Error: ${response.status}`),
            reqToSync,
          );
        }
        await this.handleFailure(reqToSync);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (this.config.onError) {
        await this.config.onError(null, error, reqToSync);
      }

      await this.handleFailure(reqToSync);
    }
  }

  /**
   * MITIGATION 2: The Dead Letter Queue logic
   */
  private async handleFailure(request: QueuedRequest): Promise<void> {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries ?? 3;

    if (request.retryCount >= maxRetries) {
      this.engine.log(
        "warn",
        `[Axiom] Request ${request.id} failed ${maxRetries} times. Moving to Dead Letter.`,
      );
      await this.storage.remove(request.id);

      if (this.config.onDeadLetter) {
        await this.config.onDeadLetter(
          request,
          new Error("Max retries exceeded"),
        );
      }

      this.engine.emit("deadLetter", request);
    } else {
      await this.storage.save(request);
    }
  }
}
