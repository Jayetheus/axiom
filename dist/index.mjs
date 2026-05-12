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
  constructor(storage, config, engine) {
    this.storage = storage;
    this.config = config;
    this.engine = engine;
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
        this.engine.log("error", `onBeforeSync failed for ${request.id}. Marking as failure.`);
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
      if (response.ok) {
        const responseData = await response.json().catch(() => null);
        if (this.config.onResponse) {
          await this.config.onResponse(responseData, response.status, reqToSync);
        }
        await this.storage.remove(reqToSync.id);
        this.engine.log("info", `Request ${reqToSync.id} synced successfully.`);
      } else if (response.status >= 400 && response.status < 500) {
        if (this.config.onError) {
          await this.config.onError(response.status, new Error(`Client Error: ${response.status}`), reqToSync);
        }
        await this.storage.remove(reqToSync.id);
      } else {
        if (this.config.onError) {
          await this.config.onError(response.status, new Error(`Server Error: ${response.status}`), reqToSync);
        }
        await this.handleFailure(reqToSync);
      }
    } catch (error) {
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
  async handleFailure(request) {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries ?? 3;
    if (request.retryCount >= maxRetries) {
      this.engine.log("warn", `[Axiom] Request ${request.id} failed ${maxRetries} times. Moving to Dead Letter.`);
      await this.storage.remove(request.id);
      if (this.config.onDeadLetter) {
        this.config.onDeadLetter(request, new Error("Max retries exceeded"));
      }
    } else {
      await this.storage.save(request);
    }
  }
};

// src/adapters/localstorage.ts
var LocalStorageAdapter = class {
  constructor() {
    this.key = "axiom_offline_queue";
  }
  /** Safely retrieves and parses the queue from storage */
  getQueue() {
    if (typeof window === "undefined" || !window.localStorage) return [];
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error("[Axiom] Failed to parse localStorage queue", e);
      return [];
    }
  }
  /** Safely serializes and saves the queue to storage */
  setQueue(queue) {
    if (typeof window === "undefined" || !window.localStorage) return;
    localStorage.setItem(this.key, JSON.stringify(queue));
  }
  async save(request) {
    const queue = this.getQueue();
    const index = queue.findIndex((r) => r.id === request.id);
    if (index >= 0) {
      queue[index] = request;
    } else {
      queue.push(request);
    }
    this.setQueue(queue);
  }
  async getAll() {
    return this.getQueue().sort((a, b) => a.timestamp - b.timestamp);
  }
  async remove(id) {
    const queue = this.getQueue();
    this.setQueue(queue.filter((r) => r.id !== id));
  }
  async clearAll() {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(this.key);
    }
  }
};

// src/adapters/indexeddb.ts
var IndexedDBStorageAdapter = class {
  constructor() {
    this.dbName = "AxiomOfflineDB";
    this.storeName = "requests";
    this.version = 1;
  }
  async getDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async save(request) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.put(request);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async getAll() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result;
        resolve(results.sort((a, b) => a.timestamp - b.timestamp));
      };
      request.onerror = () => reject(request.error);
    });
  }
  async remove(id) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async clearAll() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, "readwrite");
      const store = transaction.objectStore(this.storeName);
      store.clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
};

// src/adapters/resolver.ts
function resolveStorageAdapter(preference, debug = false) {
  const isBrowser = typeof window !== "undefined";
  if (!isBrowser) {
    if (debug) console.log("[Axiom Debug] Non-browser environment detected (React Native/SSR). Defaulting to Memory adapter.");
    return new MemoryStorageAdapter();
  }
  if (preference === "indexeddb" && window.indexedDB) {
    if (debug) console.log("[Axiom Debug] IndexedDB adapter initialized.");
    return new IndexedDBStorageAdapter();
  }
  if ((preference === "localstorage" || preference === "indexeddb") && window.localStorage) {
    if (debug) console.log(`[Axiom Debug] ${preference === "indexeddb" ? "IndexedDB unavailable. " : ""}LocalStorage adapter initialized.`);
    return new LocalStorageAdapter();
  }
  if (debug) console.log("[Axiom Debug] No persistent browser storage available. Falling back to Memory adapter.");
  return new MemoryStorageAdapter();
}

// src/engine/fetcher.ts
var AxiomEngine = class {
  constructor() {
    this.config = {};
    this.storage = new MemoryStorageAdapter();
    this.listeners = /* @__PURE__ */ new Map();
  }
  /** Internal verbose logger */
  log(...args) {
    if (this.config.debug) {
      if (args[0] === "error") {
        console.error("\u{1F6D1} [Axiom Error]", ...args);
      } else if (args[0] === "warn") {
        console.warn("\u26A0\uFE0F [Axiom Warn]", ...args);
      } else if (args[0] === "info") {
        console.info("\u2139\uFE0F [Axiom Info]", ...args);
      } else {
        console.log("\u{1F41B} [Axiom Debug]", ...args);
      }
    }
  }
  /** Registers an event listener for Axiom lifecycle events (e.g., sync attempts, successes, failures). */
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, /* @__PURE__ */ new Set());
    }
    this.listeners.get(event).add(listener);
  }
  /** Unregisters a previously registered event listener. */
  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }
  /** Internal method to emit events to registered listeners. */
  emit(event, ...args) {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
  /**
   * Initializes the Axiom engine with global configuration and a storage adapter.
   * This must be called before making any requests to enable persistence.
   * * @param config - Global configuration (baseURL, timeouts, custom headers, etc.)
   * @param storageAdapter - Optional custom adapter (e.g., MMKV). Defaults to in-memory storage.
   */
  create(config, storageAdapter) {
    this.config = config;
    if (this.config.debug) this.log("info", "Engine initializing with config:", config);
    if (storageAdapter) {
      this.storage = storageAdapter;
      this.log("info", "Custom storage adapter injected manually.");
    } else {
      const fallback = config.fallbackAdapter || "memory";
      this.storage = resolveStorageAdapter(fallback, !!config.debug);
    }
    this.syncManager = new SyncManager(this.storage, this.config, this);
  }
  /**
   * Manually triggers the background sync manager to flush all pending queued requests.
   * Note: This is automatically handled by `AxiomProvider` when the network reconnects.
   */
  async forceSync() {
    if (!this.syncManager) {
      this.log("error", "[Axiom] Engine not initialized. Call axiom.create() first.");
      return;
    }
    await this.syncManager.flushQueue();
  }
  /**
   * Retrieves all currently queued requests from the storage adapter.
   * Useful for debugging or rendering an "Outbox" UI of pending actions.
   * @returns Promise resolving to an array of queued requests with their metadata.
   */
  async getQueue() {
    if (!this.storage) {
      this.log("warn", "[Axiom] Engine not initialized. Cannot inspect queue.");
      return [];
    }
    return this.storage.getAll();
  }
  /**
   * Cancels and removes a specific request from the pending queue by its ID.
   * @param id - The unique ID of the queued request to cancel.
   * @returns Promise that resolves when the request is removed from storage.
   */
  async cancelRequest(id) {
    if (!this.storage) {
      this.log("warn", "[Axiom] Engine not initialized. Cannot cancel request.");
      return;
    }
    await this.storage.remove(id);
    this.log("info", `[Axiom] Cancelled queued request ${id}`);
    this.emit("requestCancelled", id);
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
    if (options?.headers) Object.assign(headers, options.headers);
    if (data) headers["Content-Type"] = "application/json";
    const request = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method,
      headers,
      body: data ? JSON.stringify(data) : void 0,
      priority: options?.priority || "urgent",
      retryCount: 0,
      metadata: options?.metadata
    };
    const timeoutMs = options?.timeout || this.config.timeout || 8e3;
    return this.attemptFetch(request, timeoutMs);
  }
  /**
    * Internal logic to fire the request or catch the network drop.
    * Handles timeout cancellations and triggers Global Interceptors.
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
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        console.warn(`[Axiom] Request to ${request.url} timed out after ${timeoutMs}ms. Queuing for retry.`);
      }
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
  async enqueueRequest(request) {
    this.log("warn", `Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
  }
};
var axiom = new AxiomEngine();

// src/react/AxiomProvider.tsx
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { jsx } from "react/jsx-runtime";
var AxiomContext = createContext({
  isOnline: true,
  forceSync: async () => {
  },
  deadLetters: [],
  clearDeadLetters: () => {
  },
  inspectQueue: async () => [],
  cancelRequest: async () => {
  }
});
var AxiomProvider = ({
  config,
  storageAdapter,
  fallbackAdapter,
  networkListener,
  children
}) => {
  const [isOnline, setIsOnline] = useState(true);
  const [deadLetters, setDeadLetters] = useState([]);
  const enhancedConfig = {
    ...config,
    fallbackAdapter,
    onDeadLetter: (request, error) => {
      setDeadLetters((prev) => [...prev, request]);
      if (config.onDeadLetter) config.onDeadLetter(request, error);
    }
  };
  useEffect(() => {
    axiom.create(enhancedConfig, storageAdapter);
    let unsubscribe;
    const handleNetworkChange = (status) => {
      setIsOnline(status);
      if (status) {
        axiom.forceSync();
      }
    };
    if (networkListener) {
      unsubscribe = networkListener(handleNetworkChange);
    } else if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine);
      const goOnline = () => handleNetworkChange(true);
      const goOffline = () => handleNetworkChange(false);
      window.addEventListener("online", goOnline);
      window.addEventListener("offline", goOffline);
      unsubscribe = () => {
        window.removeEventListener("online", goOnline);
        window.removeEventListener("offline", goOffline);
      };
    }
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [enhancedConfig, storageAdapter, networkListener]);
  const clearDeadLetters = useCallback(() => setDeadLetters([]), []);
  return /* @__PURE__ */ jsx(AxiomContext.Provider, { value: {
    isOnline,
    forceSync: () => axiom.forceSync(),
    deadLetters,
    clearDeadLetters,
    inspectQueue: () => axiom.getQueue(),
    cancelRequest: (id) => axiom.cancelRequest(id)
  }, children });
};
var useAxiomContext = () => useContext(AxiomContext);

// src/react/useAxiomQueue.ts
function useAxiomQueue() {
  const { isOnline, forceSync, deadLetters, clearDeadLetters, inspectQueue, cancelRequest } = useAxiomContext();
  return {
    /** Boolean indicating if the device currently has an active connection */
    isOnline,
    /** Manually trigger the background sync manager */
    forceSync,
    /** Array of requests that failed permanently (exceeded max retries) */
    deadLetters,
    /** Clears the dead letter queue from the UI state */
    clearDeadLetters,
    /** Retrieves the current pending queue directly from storage */
    inspectQueue,
    /** Cancels and removes a specific request from the pending queue */
    cancelRequest
  };
}
export {
  AxiomEngine,
  AxiomProvider,
  MemoryStorageAdapter,
  axiom,
  useAxiomQueue
};
