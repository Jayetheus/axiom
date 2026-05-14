import type { AxiomStorageAdapter, QueuedRequest } from "../types";

/**
 * A persistent storage adapter utilizing the browser's native localStorage API.
 * Ideal as a fallback for web environments where IndexedDB is restricted.
 */
export class LocalStorageAdapter implements AxiomStorageAdapter {
  private key = "axiom_offline_queue";
  private deadLetterKey = "axiom_dead_letters";

  /** Safely retrieves and parses the queue from storage */
  private getQueue(key: string): QueuedRequest[] {
    if (typeof window === "undefined" || !window.localStorage) return [];

    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error("[Axiom] Failed to parse localStorage queue", e);
      return [];
    }
  }

  /** Safely serializes and saves the queue to storage */
  private setQueue(key: string, queue: QueuedRequest[]): void {
    if (typeof window === "undefined" || !window.localStorage) return;
    try {
      localStorage.setItem(key, JSON.stringify(queue));
    } catch (e) {
      console.error("[Axiom] Failed to write localStorage queue", e);
    }
  }

  async save(request: QueuedRequest): Promise<void> {
    const queue = this.getQueue(this.key);
    const index = queue.findIndex((r) => r.id === request.id);

    if (index >= 0) {
      queue[index] = request;
    } else {
      queue.push(request);
    }

    this.setQueue(this.key, queue);
  }

  async getAll(): Promise<QueuedRequest[]> {
    return this.getQueue(this.key).sort((a, b) => a.timestamp - b.timestamp);
  }

  async remove(id: string): Promise<void> {
    const queue = this.getQueue(this.key);
    this.setQueue(
      this.key,
      queue.filter((r) => r.id !== id),
    );
  }

  async clearAll(): Promise<void> {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(this.key);
    }
  }

  async saveDeadLetter(request: QueuedRequest): Promise<void> {
    const queue = this.getQueue(this.deadLetterKey);
    const index = queue.findIndex((r) => r.id === request.id);

    if (index >= 0) {
      queue[index] = request;
    } else {
      queue.push(request);
    }

    this.setQueue(this.deadLetterKey, queue);
  }

  async getDeadLetters(): Promise<QueuedRequest[]> {
    return this.getQueue(this.deadLetterKey).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }

  async clearDeadLetters(): Promise<void> {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.removeItem(this.deadLetterKey);
    }
  }
}
