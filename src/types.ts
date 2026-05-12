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
export interface AxiomRequestOptions {
  /** Overrides the queue sorting behavior for this specific request. */
  priority?: RequestPriority;
  /** Overrides the global timeout limit for this specific request. */
  timeout?: number;
  /** Specific headers to append to this single request (e.g., custom Content-Type). */
  headers?: Record<string, string>;
}