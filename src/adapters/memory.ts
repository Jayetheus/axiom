import type { AxiomStorageAdapter, QueuedRequest } from "../types";

export class MemoryStorageAdapter implements AxiomStorageAdapter {
  private queue: Map<string, QueuedRequest> = new Map();
  private deadLetters: Map<string, QueuedRequest> = new Map();

  async save(request: QueuedRequest): Promise<void> {
    this.queue.set(request.id, request);
  }

  async getAll(): Promise<QueuedRequest[]> {
    return Array.from(this.queue.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  async remove(id: string): Promise<void> {
    this.queue.delete(id);
  }

  async clearAll(): Promise<void> {
    this.queue.clear();
  }

  async saveDeadLetter(request: QueuedRequest): Promise<void> {
    this.deadLetters.set(request.id, request);
  }

  async getDeadLetters(): Promise<QueuedRequest[]> {
    return Array.from(this.deadLetters.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  async clearDeadLetters(): Promise<void> {
    this.deadLetters.clear();
  }
}
