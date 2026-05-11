import { QueuedRequest } from '../types';

export interface AxiomStorageAdapter {
  /** Saves a request to the persistent queue */
  save(request: QueuedRequest): Promise<void>;
  
  /** Retrieves all pending requests, usually ordered by timestamp */
  getAll(): Promise<QueuedRequest[]>;
  
  /** Removes a specific request after it successfully syncs */
  remove(id: string): Promise<void>;
  
  /** Wipes the queue entirely (useful for user logout) */
  clearAll(): Promise<void>;
}