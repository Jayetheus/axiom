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
   */
  async flushQueue() {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      const pending = await this.storage.getAll();
      if (pending.length === 0) {
        this.isSyncing = false;
        return;
      }
      console.log(`[Axiom] Network restored. Syncing ${pending.length} queued requests...`);
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
  async processRequest(request) {
    let reqToSync = request;
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
      if (response.ok || response.status >= 400 && response.status < 500) {
        await this.storage.remove(reqToSync.id);
        console.log(`[Axiom] Request ${reqToSync.id} synced successfully.`);
      } else {
        await this.handleFailure(reqToSync);
      }
    } catch (error) {
      await this.handleFailure(reqToSync);
    }
  }
  /**
   * MITIGATION 2: The Dead Letter Queue logic
   */
  async handleFailure(request) {
    request.retryCount += 1;
    const maxRetries = this.config.maxRetries || 3;
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
   * Initializes the Axiom engine with your specific rules and storage.
   */
  create(config, storageAdapter) {
    this.config = config;
    if (storageAdapter) {
      this.storage = storageAdapter;
    }
    this.syncManager = new SyncManager(this.storage, this.config);
  }
  async forceSync() {
    if (!this.syncManager) {
      console.error("[Axiom] Engine not initialized. Call axiom.create() first.");
      return;
    }
    await this.syncManager.flushQueue();
  }
  /**
   * Generates a unique ID for queued requests.
   */
  generateId() {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
  /**
   * The core POST method. 
   */
  async post(url, data, options) {
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    const request = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.defaultHeaders || {}
      },
      body: data ? JSON.stringify(data) : void 0,
      priority: options?.priority || "urgent",
      retryCount: 0
    };
    return this.attemptFetch(request);
  }
  /** The core GET method.
   * Note: GET requests typically don't have a body, but we still want to queue them if offline.
   */
  async get(url, options) {
    const fullUrl = this.config.baseURL ? `${this.config.baseURL}${url}` : url;
    const request = {
      id: this.generateId(),
      timestamp: Date.now(),
      url: fullUrl,
      method: "GET",
      headers: {
        ...this.config.defaultHeaders || {}
      },
      priority: options?.priority || "urgent",
      retryCount: 0
    };
    return this.attemptFetch(request);
  }
  /**
   * Internal logic to fire the request or catch the network drop.
   */
  async attemptFetch(request) {
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
        throw new Error("Server Error");
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
  async enqueueRequest(request) {
    console.warn(`[Axiom] Network unreachable. Queuing request ${request.id}`);
    await this.storage.save(request);
  }
};
var axiom = new AxiomEngine();

// src/react/AxiomProvider.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";
var AxiomContext = createContext({
  isOnline: true,
  forceSync: async () => {
  }
});
var AxiomProvider = ({ config, storageAdapter, networkListener, children }) => {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
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
  return /* @__PURE__ */ jsx(AxiomContext.Provider, { value: { isOnline, forceSync: () => axiom.forceSync() }, children });
};
var useAxiomContext = () => useContext(AxiomContext);

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
export {
  AxiomEngine,
  AxiomProvider,
  MemoryStorageAdapter,
  axiom,
  useAxiomQueue
};
