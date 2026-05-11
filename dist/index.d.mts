import React from 'react';

type RequestPriority = 'urgent' | 'background';
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
interface AxiomConfig {
    baseURL?: string;
    defaultHeaders?: Record<string, string>;
    maxRetries?: number;
    onBeforeSync?: (request: QueuedRequest) => Promise<QueuedRequest>;
    onDeadLetter?: (request: QueuedRequest, error: Error) => void;
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
     * Initializes the Axiom engine with your specific rules and storage.
     */
    create(config: AxiomConfig, storageAdapter?: AxiomStorageAdapter): void;
    forceSync(): Promise<void>;
    /**
     * Generates a unique ID for queued requests.
     */
    private generateId;
    /**
     * The core POST method.
     */
    post<T>(url: string, data?: any, options?: {
        priority?: RequestPriority;
    }): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /** The core GET method.
     * Note: GET requests typically don't have a body, but we still want to queue them if offline.
     */
    get<T>(url: string, options?: {
        priority?: RequestPriority;
    }): Promise<{
        data?: T;
        status: number;
        isQueued: boolean;
    }>;
    /**
     * Internal logic to fire the request or catch the network drop.
     */
    private attemptFetch;
    /**
     * Saves the request to whatever storage adapter was provided on startup.
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

export { type AxiomConfig, AxiomEngine, AxiomProvider, type AxiomStorageAdapter, MemoryStorageAdapter, type QueuedRequest, type RequestPriority, axiom, useAxiomQueue };
