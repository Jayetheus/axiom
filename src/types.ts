/** * Defines how the request should be treated when the queue flushes. 
 * Urgent requests bypass the background queue entirely if the network is active.
 */
export type RequestPriority = 'urgent' | 'background';

/** * Represents a serialized HTTP request frozen in offline storage. 
 */
export interface QueuedRequest {
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
export interface AxiomConfig {
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
export interface AxiomRequestOptions {
  /** Overrides the queue sorting behavior for this specific request. */
  priority?: RequestPriority;
  /** Overrides the global timeout limit for this specific request. */
  timeout?: number;
  /** Specific headers to append to this single request (e.g., custom Content-Type). */
  headers?: Record<string, string>;
}