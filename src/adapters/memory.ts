import { AxiomStorageAdapter } from './index';
import { QueuedRequest } from '../types';

export class MemoryStorageAdapter implements AxiomStorageAdapter {
  private queue: Map<string, QueuedRequest> = new Map();

  async save(request: QueuedRequest): Promise<void> {
    this.queue.set(request.id, request);
  }

  async getAll(): Promise<QueuedRequest[]> {
    return Array.from(this.queue.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  async remove(id: string): Promise<void> {
    this.queue.delete(id);
  }

  async clearAll(): Promise<void> {
    this.queue.clear();
  }
}