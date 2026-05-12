import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncManager } from '../src/engine/sync';
import { MemoryStorageAdapter } from '../src/adapters/memory';
import { AxiomConfig, QueuedRequest } from '../src/types';

describe('SyncManager Background Logic', () => {
  let mockStorage: MemoryStorageAdapter;

  beforeEach(() => {
    mockStorage = new MemoryStorageAdapter();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createDummyRequest = (id: string, priority: 'urgent' | 'background', timestamp: number): QueuedRequest => ({
    id,
    timestamp,
    url: '/test',
    method: 'POST',
    headers: {},
    priority,
    retryCount: 0
  });

  it('should respect Priority Lanes (Urgent before Background)', async () => {
    // Add three items out of order
    await mockStorage.save(createDummyRequest('req-bg-1', 'background', 100));
    await mockStorage.save(createDummyRequest('req-urgent-1', 'urgent', 200));
    await mockStorage.save(createDummyRequest('req-bg-2', 'background', 50));

    // Mock fetch to track the order of calls
    const fetchTracker = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.mocked(fetch).mockImplementation(fetchTracker);

    const syncManager = new SyncManager(mockStorage, {});
    await syncManager.flushQueue();

    // Verify fetch was called 3 times
    expect(fetchTracker).toHaveBeenCalledTimes(3);

    // Verify 'req-urgent-1' was synced first despite having a later timestamp
    const firstCallUrl = fetchTracker.mock.calls[0][0]; 
    // Wait, our dummy requests all have the same URL. Let's spy on the storage remove instead.
  });

  it('should process Priority Lanes correctly via Storage removal', async () => {
     // A better way to test priority is to spy on processRequest / storage.remove
     await mockStorage.save(createDummyRequest('bg-old', 'background', 100));
     await mockStorage.save(createDummyRequest('urgent', 'urgent', 200));
     await mockStorage.save(createDummyRequest('bg-new', 'background', 300));
 
     vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
     
     const removeSpy = vi.spyOn(mockStorage, 'remove');
     const syncManager = new SyncManager(mockStorage, {});
     
     await syncManager.flushQueue();
 
     // Expected order: urgent, then bg-old (timestamp 100), then bg-new (timestamp 300)
     expect(removeSpy.mock.calls[0][0]).toBe('urgent');
     expect(removeSpy.mock.calls[1][0]).toBe('bg-old');
     expect(removeSpy.mock.calls[2][0]).toBe('bg-new');
  });

  it('should execute onBeforeSync to refresh tokens before flushing', async () => {
    await mockStorage.save(createDummyRequest('req-1', 'urgent', 100));

    // Mock fetch to capture what headers were ACTUALLY sent
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const onBeforeSyncMock = vi.fn().mockImplementation(async (req: any) => {
      return { ...req, headers: { Authorization: 'Bearer NEW_TOKEN' } };
    });

    const syncManager = new SyncManager(mockStorage, { onBeforeSync: onBeforeSyncMock });
    await syncManager.flushQueue();

    expect(onBeforeSyncMock).toHaveBeenCalledTimes(1);
    
    // Check that fetch received the new token
    const fetchOptions = vi.mocked(fetch).mock.calls[0][1];
    expect(fetchOptions?.headers).toEqual({ Authorization: 'Bearer NEW_TOKEN' });
  });

  it('should move items to the Dead Letter Queue after max retries', async () => {
    // Create a request that has already failed 2 times
    const failingRequest = createDummyRequest('fail-req', 'urgent', 100);
    failingRequest.retryCount = 2;
    await mockStorage.save(failingRequest);

    // Force a 500 server error
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const onDeadLetterMock = vi.fn();
    const syncManager = new SyncManager(mockStorage, { 
      maxRetries: 3, 
      onDeadLetter: onDeadLetterMock 
    });

    await syncManager.flushQueue();

    // It should have failed for the 3rd time
    expect(onDeadLetterMock).toHaveBeenCalledTimes(1);
    expect(onDeadLetterMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fail-req', retryCount: 3 }), 
      expect.any(Error)
    );

    // It should be completely removed from storage to prevent infinite loops
    const pending = await mockStorage.getAll();
    expect(pending.length).toBe(0);
  });
});