export type RequestPriority = 'urgent' | 'background';

export interface QueuedRequest {
  id: string;
  timestamp: number;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers: Record<string, string>;
  body?: string; // Serialized JSON
  priority: RequestPriority;
  retryCount: number;
}

export interface AxiomConfig {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  onBeforeSync?: (request: QueuedRequest) => Promise<QueuedRequest>;
  onDeadLetter?: (request: QueuedRequest, error: Error) => void;
}