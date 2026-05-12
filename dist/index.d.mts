import React from 'react';

/** * Defines how the request should be treated when the queue flushes.
 * Urgent requests bypass the background queue entirely if the network is active.
 */
type RequestPriority = 'urgent' | 'background';
/** * Represents a serialized HTTP request frozen in offline storage.
 */
interface QueuedRequest<TBody = any, TMeta = Record<string, any>> {
    id: string;
    timestamp: number;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers: Record<string, string>;
    body?: TBody;
    priority: RequestPriority;
    retryCount: number;
    /** Custom metadata attached by the developer for UI or analytics context */
    metadata?: TMeta;
}
/**
 *  Global configuration for the Axiom engine initialized on startup.
 */
interface AxiomConfig {
    /** The base URL prepended to all request paths. */
    baseURL?: string;
    /** Global headers applied to every request (e.g., Auth tokens). */
    defaultHeaders?: Record<string, string>;
    /** The maximum number of times a queued request will attempt to sync before failing permanently. */
    maxRetries?: number;
    /** Global timeout in milliseconds before a request is aborted and queued. */
    timeout?: number;
    /** If true, Axiom will log verbose trace details to the console to aid in debugging. */
    debug?: boolean;
    /** Instructs the engine which built-in adapter to attempt to use if a custom one isn't provided.
     * @default 'memory' - We default to the most universally compatible adapter to avoid silent failures in unsupported environments (e.g., IndexedDB in Safari Private Mode).
     * Developers can specify 'indexeddb' or 'localstorage' to attempt those adapters first in browser environments, but Axiom will gracefully fall back to 'memory' if the requested adapter isn't supported (e.g., IndexedDB in Safari Private Mode, localStorage in React Native).
     * Note: In non-browser environments (React Native, SSR), Axiom will always use the Memory adapter regardless of this setting, since IndexedDB and localStorage aren't available.
     */
    fallbackAdapter?: 'indexeddb' | 'localstorage' | 'memory';
    /** Middleware hook triggered immediately before a queued request is synced. Ideal for refreshing Auth tokens.
     * @param request The request about to be synced, allowing for last-minute modifications (e.g., updating headers).
     * @returns A Promise that resolves to the modified request to be synced, or the original request if no changes are needed.
    */
    onBeforeSync?: (request: QueuedRequest) => Promise<QueuedRequest>;
    /** Callback triggered when a request exceeds maxRetries and is permanently removed from the queue.
     * @param request The request that failed permanently.
     * @param error The error that caused the final failure (e.g., last network error or response status).
     * @returns void or a Promise that resolves when any cleanup is complete (e.g., removing related data from IndexedDB).
    */
    onDeadLetter?: (request: QueuedRequest, error: Error) => void | Promise<void>;
    /**
     * Triggered globally whenever ANY request succeeds (returns 2xx).
     * Fires for both immediate online requests AND successful background syncs.
     * @param data The response data from the successful request.
     * @param status The HTTP status code of the successful response.
     * @param request The original request object that succeeded, useful for correlating responses to queued requests.
     * @returns void or a Promise that resolves when any post-response processing is complete (e.g., updating local state).
     */
    onResponse?: (data: any, status: number, request: QueuedRequest) => void | Promise<void>;
    /**
     * Triggered globally whenever a request encounters a hard failure
     * (e.g., 401 Unauthorized, 500 Server Error) or a network drop (status will be null).
     * @param status The HTTP status code of the failed response, or null if the failure was due to a network error.
     * @param error The Error object representing the failure, which may include additional details (e.g., error message, stack trace).
     * @param request The original request object that failed, useful for correlating errors to queued requests.
     * @returns void or a Promise that resolves when any error handling is complete (e.g., logging, user notifications).
     */
    onError?: (status: number | null, error: Error, request: QueuedRequest) => void | Promise<void>;
}
/** * Per-request configuration options that override the global configuration.
 */
interface AxiomRequestOptions<TMeta = Record<string, any>> {
    /** Overrides the queue sorting behavior for this specific request. */
    priority?: RequestPriority;
    /** Overrides the global timeout limit for this specific request. */
    timeout?: number;
    /** Specific headers to append to this single request (e.g., custom Content-Type). */
    headers?: Record<string, string>;
    /** Inject custom metadata that will survive serialization and persist in the queue */
    metadata?: TMeta;
}

interface AxiomStorageAdapter {
    /** Saves a request to the persistent queue */
    save(request: QueuedRequest): Promise<void>;
    /** Retrieves all pending requests, usually ordered by timestamp */
    getAll(): Promise<QueuedRequest[]>;
    /** Removes a specific request after it successfully syncs */
    remove(id: string): Promise<void>;
    /** Wipes the queue entirely (useful for user logout) */
    clearAll(): Promise<void>;
}

declare class MemoryStorageAdapter implements AxiomStorageAdapter {
    private queue;
    save(request: QueuedRequest): Promise<void>;
    getAll(): Promise<QueuedRequest[]>;
    remove(id: string): Promise<void>;
    clearAll(): Promise<void>;
}

type AxiomEvent = 'syncStart' | 'syncSuccess' | 'syncError' | 'deadLetter' | 'requestCancelled';
type AxiomEventListener = (...args: any[]) => void;
declare class AxiomEngine {
    private config;
    private storage;
    private syncManager;
    private listeners;
    /** Internal verbose logger */
    log(...args: any[]): void;
    /** Registers an event listener for Axiom lifecycle events (e.g., sync attempts, successes, failures). */
    on(event: AxiomEvent, listener: AxiomEventListener): void;
    /** Unregisters a previously registered event listener. */
    off(event: AxiomEvent, listener: AxiomEventListener): void;
    /** Internal method to emit events to registered listeners. */
    emit(event: AxiomEvent, ...args: any[]): void;
    /**
     * Initializes the Axiom engine with global configuration and a storage adapter.
     * This must be called before making any requests to enable persistence.
     * * @param config - Global configuration (baseURL, timeouts, custom headers, etc.)
     * @param storageAdapter - Optional custom adapter (e.g., MMKV). Defaults to in-memory storage.
     */
    create(config: AxiomConfig, storageAdapter?: AxiomStorageAdapter): void;
    /**
     * Manually triggers the background sync manager to flush all pending queued requests.
     * Note: This is automatically handled by `AxiomProvider` when the network reconnects.
     */
    forceSync(): Promise<void>;
    /**
     * Retrieves all currently queued requests from the storage adapter.
     * Useful for debugging or rendering an "Outbox" UI of pending actions.
     * @returns Promise resolving to an array of queued requests with their metadata.
     */
    getQueue(): Promise<QueuedRequest[]>;
    /**
     * Cancels and removes a specific request from the pending queue by its ID.
     * @param id - The unique ID of the queued request to cancel.
     * @returns Promise that resolves when the request is removed from storage.
     */
    cancelRequest(id: string): Promise<void>;
    /**
     * Generates a unique collision-resistant ID for queued requests.
     */
    private generateId;
    /**
     * Executes an HTTP GET request.
     * If the network is unavailable or times out, the request is safely queued.
     * * @param url - The endpoint URL (appended to baseURL if configured).
     * @param options - Request-specific options (priority lanes, timeout overrides).
     * @returns A promise resolving to the response data, status code, and queue state.
     */
    get<T>(url: string, options?: AxiomRequestOptions): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Executes an HTTP POST request.
     * If the network is unavailable or times out, the payload is safely queued.
     * * @param url - The endpoint URL.
     * @param data - The payload object to be serialized and sent.
     * @param options - Request-specific options.
     */
    post<T>(url: string, data?: any, options?: AxiomRequestOptions): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Executes an HTTP PUT request to entirely replace a resource.
     * * @param url - The endpoint URL.
     * @param data - The payload object to be serialized and sent.
     * @param options - Request-specific options.
     */
    put<T>(url: string, data?: any, options?: AxiomRequestOptions): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Executes an HTTP PATCH request to partially update a resource.
     * * @param url - The endpoint URL.
     * @param data - The partial payload object to be serialized and sent.
     * @param options - Request-specific options.
     */
    patch<T>(url: string, data?: any, options?: AxiomRequestOptions): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Executes an HTTP DELETE request.
     * * @param url - The endpoint URL.
     * @param options - Request-specific options.
     */
    delete<T>(url: string, options?: AxiomRequestOptions): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Internal helper to consolidate request preparation and keep the engine DRY.
     */
    private prepareRequest;
    /**
      * Internal logic to fire the request or catch the network drop.
      * Handles timeout cancellations and triggers Global Interceptors.
      */
    private attemptFetch;
    /**
     * Saves the request to the configured storage adapter.
     */
    private enqueueRequest;
}
declare const axiom: AxiomEngine;

/**
 * Configuration properties for the AxiomProvider.
 */
interface AxiomProviderProps {
    /** The global configuration object for the Axiom engine (e.g., baseURL, timeout, maxRetries). */
    config: AxiomConfig;
    /** Optional: A custom storage adapter (e.g., MMKV, AsyncStorage) to override the default built-in adapters. */
    storageAdapter?: AxiomStorageAdapter;
    /** * Optional: Instructs the engine which built-in adapter to attempt to use if a custom one isn't provided.
     * Safely falls back to 'memory' if the chosen adapter is unsupported in the current environment.
     */
    fallbackAdapter?: 'indexeddb' | 'localstorage' | 'memory';
    /** * Optional: A custom network listener function. Highly recommended for React Native (e.g., NetInfo.addEventListener).
     * If omitted, Axiom safely falls back to standard Web APIs (window.addEventListener('online')).
     */
    networkListener?: (callback: (isOnline: boolean) => void) => any;
    /** Your React application tree. */
    children: React.ReactNode;
}
/**
 * The root provider for the Axiom offline-first fetch wrapper.
 * * This component initializes the background engine, sets up network state listeners,
 * and provides the real-time queue state to the rest of your React application.
 * * @example
 * ```tsx
 * <AxiomProvider
 * config={{ baseURL: '[https://api.example.com](https://api.example.com)', debug: true }}
 * fallbackAdapter="indexeddb"
 * >
 * <App />
 * </AxiomProvider>
 * ```
 */
declare const AxiomProvider: React.FC<AxiomProviderProps>;

declare function useAxiomQueue(): {
    /** Boolean indicating if the device currently has an active connection */
    isOnline: boolean;
    /** Manually trigger the background sync manager */
    forceSync: () => Promise<void>;
    /** Array of requests that failed permanently (exceeded max retries) */
    deadLetters: QueuedRequest<any, Record<string, any>>[];
    /** Clears the dead letter queue from the UI state */
    clearDeadLetters: () => void;
    /** Retrieves the current pending queue directly from storage */
    inspectQueue: () => Promise<QueuedRequest[]>;
    /** Cancels and removes a specific request from the pending queue */
    cancelRequest: (id: string) => Promise<void>;
};

export { type AxiomConfig, AxiomEngine, AxiomProvider, type AxiomRequestOptions, type AxiomStorageAdapter, MemoryStorageAdapter, type QueuedRequest, type RequestPriority, axiom, useAxiomQueue };
