import { AxiomStorageAdapter } from './index';
import { QueuedRequest } from '../types';

/**
 * A persistent storage adapter utilizing the browser's native localStorage API.
 * Ideal as a fallback for web environments where IndexedDB is restricted.
 */
export class LocalStorageAdapter implements AxiomStorageAdapter {
  private key = 'axiom_offline_queue';

  /** Safely retrieves and parses the queue from storage */
  private getQueue(): QueuedRequest[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    
    try {
      const data = localStorage.getItem(this.key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[Axiom] Failed to parse localStorage queue', e);
      return [];
    }
  }

  /** Safely serializes and saves the queue to storage */
  private setQueue(queue: QueuedRequest[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    localStorage.setItem(this.key, JSON.stringify(queue));
  }

  async save(request: QueuedRequest): Promise<void> {
    const queue = this.getQueue();
    const index = queue.findIndex(r => r.id === request.id);
    
    if (index >= 0) {
      queue[index] = request; 
    } else {
      queue.push(request); 
    }
    
    this.setQueue(queue);
  }

  async getAll(): Promise<QueuedRequest[]> {
    return this.getQueue().sort((a, b) => a.timestamp - b.timestamp);
  }

  async remove(id: string): Promise<void> {
    const queue = this.getQueue();
    this.setQueue(queue.filter(r => r.id !== id));
  }

  async clearAll(): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(this.key);
    }
  }
}