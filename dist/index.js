"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AxiomEngine: () => AxiomEngine,
  AxiomProvider: () => AxiomProvider,
  MemoryStorageAdapter: () => MemoryStorageAdapter,
  axiom: () => axiom,
  useAxiomQueue: () => useAxiomQueue
});
module.exports = __toCommonJS(index_exports);

// src/adapters/memory.ts
var MemoryStorageAdapter = class {
  constructor() {
    this.queue = /* @__PURE__ */ new Map();
  }
  async save(request) {
    this.queue.set(request.id, request);
  }
  async getAll() {
    return Array.from(this.queue.values()).sort((a, b) => a.timestamp - b.timestamp);
  }
  async remove(id) {
    this.queue.delete(id);
  }
  async clearAll() {
    this.queue.clear();
  }
};

// src/engine/sync.ts
var SyncManager = class {
  constructor(storage, config) {
    this.storage = storage;
    this.config = config;
    this.isSyncing = false;
  }
  /**
   * The master trigger. Call this when the OS reports network is back online.
   * Automatically sorts requests so 'urgent' items bypass 'background' items.
   */
  async flushQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const pending = await this.storage.getAll();
      if (pending.length === 0) {
        return;
      }
      console.log(`[Axiom] Network restored. Syncing ${pending.length} queued requests...`);
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
  async processRequest(request) {
    let reqToSync = request;
    if (this.config.onBeforeSync) {
      try {
        reqToSync = await this.config.onBeforeSync(request);
      } catch (error) {
        console.error(`[Axiom] onBeforeSync failed for ${request.id}. Marking as failure.`);
        await this.handleFailure(request);
        return;
      }
    }
    const controller = new AbortController();
    const timeoutMs = this.config.timeout || 1e4;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(reqToSync.url, {
        method: reqToSync.method,
        headers: reqToSync.headers,
        body: reqToSync.body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok || response.status >= 400 && response.status < 500) {
        await this.storage.remove(reqToSync.id);
        console.log(`[Axiom] Request ${reqToSync.id} synced successfully.`);
      } else {
        await this.handleFailure(reqToSync);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      await this.handleFailure(reqToSync);
    }
  }
  /**
   * MITIGATION 2: The Dead Letter Queue logic
   */
  async handleFailure(request) {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries ?? 3;
    if (request.retryCount >= maxRetries) {
      console.warn(`[Axiom] Request ${request.id} failed ${maxRetries} times. Moving to Dead Letter.`);
      await this.storage.remove(request.id);
      if (this.config.onDeadLetter) {
        this.config.onDeadLetter(request, new Error("Max retries exceeded"));
      }
    } else {
      await this.storage.save(request);
    }
  }
};

// src/engine/fetcher.ts
var AxiomEngine = class {
  constructor() {
    this.config = {};
    this.storage = new MemoryStorageAdapter();
  }
  /**
   * Initializes the Axiom engine with global configuration and a storage adapter.
   * This must be called before making any requests to enable persistence.
   * * @param config - Global configuration (baseURL, timeouts, custom headers, etc.)
   * @param storageAdapter - Optional custom adapter (e.g., MMKV). Defaults to in-memory storage.
   */
  create(config, storageAdapter) {
    this.config = config;
    if (storageAdapter) {
      this.storage = storageAdapter;
    }
    this.syncManager = new SyncManager(this.storage, this.config);
  }
  /**
   * Manually triggers the background sync manager to flush all pending queued requests.
   * Note: This is automatically handled by `AxiomProvider` when the network reconnects.
   */
  async forceSync() {
    if (!this.syncManager) {
      console.error("[Axiom] Engine not initialized. Call axiom.create() first.");
      return;
    }
    await this.syncManager.flushQueue();
  }
  /**
   * Generates a unique collision-resistant ID for queued requests.
   */
  generateId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
  /**
   * Executes an HTTP GET request. 
   * If the network is unavailable or times out, the request is safely queued.
   * * @param url - The endpoint URL (appended to baseURL if configured).
   * @param options - Request-specific options (priority lanes, timeout overrides).
   * @returns A promise resolving to the response data, status code, and queue state.
   */
  async get(url, options) {
    return this.prepareRequest("GET", url, void 0, options);
  }
  /**
   * Executes an HTTP POST request.
   * If the network is unavailable or times out, the payload is safely queued.
   * * @param url - The endpoint URL.
   * @param data - The payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  async post(url, data, options) {
    return this.prepareRequest("POST", url, data, options);
  }
  /**
   * Executes an HTTP PUT request to entirely replace a resource.
   * * @param url - The endpoint URL.
   * @param data - The payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  async put(url, data, options) {
    return this.prepareRequest("PUT", url, data, options);
  }
  /**
   * Executes an HTTP PATCH request to partially update a resource.
   * * @param url - The endpoint URL.
   * @param data - The partial payload object to be serialized and sent.
   * @param options - Request-specific options.
   */
  async patch(url, data, options) {
    return this.prepareRequest("PATCH", url, data, options);
  }
  /**
   * Executes an HTTP DELETE request.
   * * @param url - The endpoint URL.
   * @param options - Request-specific options.
   */
  async delete(url, options) {
    return this.prepareRequest("DELETE", url, void 0, options);
  }
  /**
   * Internal helper to consolidate request preparation and keep the engine DRY.
   */
  async prepareRequest(method, url, data, options) {
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    const headers = { ...this.config.defaultHeaders || {} };
    if (options?.headers) {
      Object.assign(headers, options.headers);
    }
    const request = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method,
      headers,
      body: data ? JSON.stringify(data) : void 0,
      priority: options?.priority || "urgent",
      retryCount: 0
    };
    const timeoutMs = options?.timeout || this.config.timeout || 8e3;
    return this.attemptFetch(request, timeoutMs);
  }
  /**
   * Internal logic to fire the request or catch the network drop.
   * Handles timeout cancellations via AbortController.
   */
  async attemptFetch(request, timeoutMs) {
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
        return { data: responseData, status: response.status, isQueued: false };
      }
      if (response.status >= 500) {
        throw new Error("Server Error");
      }
      return { status: response.status, isQueued: false };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.warn(`[Axiom] Request to ${request.url} timed out after ${timeoutMs}ms. Queuing for retry.`);
      }
      await this.enqueueRequest(request);
      return { status: 202, isQueued: true };
    }
  }
  /**
   * Saves the request to the configured storage adapter.
   */
  async enqueueRequest(request) {
    console.warn(`[Axiom] Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
  }
};
var axiom = new AxiomEngine();

// src/react/AxiomProvider.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var AxiomContext = (0, import_react.createContext)({
  isOnline: true,
  forceSync: async () => {
  }
});
var AxiomProvider = ({ config, storageAdapter, networkListener, children }) => {
  const [isOnline, setIsOnline] = (0, import_react.useState)(true);
  (0, import_react.useEffect)(() => {
    axiom.create(config, storageAdapter);
    const unsubscribe = networkListener((onlineStatus) => {
      setIsOnline(onlineStatus);
      if (onlineStatus) {
        axiom.forceSync();
      }
    });
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [config, storageAdapter, networkListener]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AxiomContext.Provider, { value: { isOnline, forceSync: () => axiom.forceSync() }, children });
};
var useAxiomContext = () => (0, import_react.useContext)(AxiomContext);

// src/react/useAxiomQueue.ts
function useAxiomQueue() {
  const { isOnline, forceSync } = useAxiomContext();
  return {
    /** Boolean indicating if the device currently has an active connection */
    isOnline,
    /** Manually trigger the background sync manager */
    forceSync
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AxiomEngine,
  AxiomProvider,
  MemoryStorageAdapter,
  axiom,
  useAxiomQueue
});
