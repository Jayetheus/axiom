import React from 'react';

/** * Defines how the request should be treated when the queue flushes.
 * Urgent requests bypass the background queue entirely if the network is active.
 */
type RequestPriority = 'urgent' | 'background';
/** * Represents a serialized HTTP request frozen in offline storage.
 */
interface QueuedRequest {
    id: string;
    timestamp: number;
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers: Record<string, string>;
    body?: string;
    priority: RequestPriority;
    retryCount: number;
}
/** * Global configuration for the Axiom engine initialized on startup.
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
    /** Middleware hook triggered immediately before a queued request is synced. Ideal for refreshing Auth tokens. */
    onBeforeSync?: (request: QueuedRequest) => Promise<QueuedRequest>;
    /** Callback triggered when a request exceeds maxRetries and is permanently removed from the queue. */
    onDeadLetter?: (request: QueuedRequest, error: Error) => void;
}
/** * Per-request configuration options that override the global configuration.
 */
interface AxiomRequestOptions {
    /** Overrides the queue sorting behavior for this specific request. */
    priority?: RequestPriority;
    /** Overrides the global timeout limit for this specific request. */
    timeout?: number;
    /** Specific headers to append to this single request (e.g., custom Content-Type). */
    headers?: Record<string, string>;
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

declare class AxiomEngine {
    private config;
    private storage;
    private syncManager;
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
     * Handles timeout cancellations via AbortController.
     */
    private attemptFetch;
    /**
     * Saves the request to the configured storage adapter.
     */
    private enqueueRequest;
}
declare const axiom: AxiomEngine;

declare const AxiomProvider: React.FC<{
    config: AxiomConfig;
    storageAdapter?: AxiomStorageAdapter;
    /** * A function that takes a callback, calls it whenever network state changes,
     * and returns an unsubscribe function.
     */
    networkListener: (callback: (isOnline: boolean) => void) => any;
    children: React.ReactNode;
}>;

declare function useAxiomQueue(): {
    /** Boolean indicating if the device currently has an active connection */
    isOnline: boolean;
    /** Manually trigger the background sync manager */
    forceSync: () => Promise<void>;
};

export { type AxiomConfig, AxiomEngine, AxiomProvider, type AxiomRequestOptions, type AxiomStorageAdapter, MemoryStorageAdapter, type QueuedRequest, type RequestPriority, axiom, useAxiomQueue };
