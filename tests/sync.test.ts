import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncManager } from "../src/engine/sync";
import { MemoryStorageAdapter } from "../src/adapters/memory";
import { QueuedRequest } from "../src/types";

describe("SyncManager Background Logic", () => {
  let mockStorage: MemoryStorageAdapter;
  let engineStub: { emit: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockStorage = new MemoryStorageAdapter();
    engineStub = { emit: vi.fn(), log: vi.fn() };
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createDummyRequest = (
    id: string,
    priority: "urgent" | "background",
    timestamp: number,
  ): QueuedRequest => ({
    id,
    timestamp,
    url: `/test/${id}`,
    method: "POST",
    headers: {},
    priority,
    retryCount: 0,
    timeoutMs: 5000,
  });

  it("processes urgent items ahead of background items", async () => {
    await mockStorage.save(createDummyRequest("bg-old", "background", 100));
    await mockStorage.save(createDummyRequest("urgent", "urgent", 200));
    await mockStorage.save(createDummyRequest("bg-new", "background", 300));

    const fetchTracker = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.mocked(fetch).mockImplementation(fetchTracker);

    const syncManager = new SyncManager(mockStorage, {}, engineStub);
    await syncManager.flushQueue();

    expect(fetchTracker.mock.calls[0][0]).toBe("/test/urgent");
    expect(fetchTracker.mock.calls[1][0]).toBe("/test/bg-old");
    expect(fetchTracker.mock.calls[2][0]).toBe("/test/bg-new");
  });

  it("executes onBeforeSync without allowing the hook to orphan the stored item", async () => {
    await mockStorage.save(createDummyRequest("req-1", "urgent", 100));

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    const onBeforeSyncMock = vi.fn().mockResolvedValue({
      ...createDummyRequest("mutated-id", "urgent", 100),
      headers: { Authorization: "Bearer NEW_TOKEN" },
    });

    const syncManager = new SyncManager(
      mockStorage,
      { onBeforeSync: onBeforeSyncMock },
      engineStub,
    );
    await syncManager.flushQueue();

    expect(onBeforeSyncMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer NEW_TOKEN",
    });
    expect(await mockStorage.getAll()).toHaveLength(0);
  });

  it("schedules exponential backoff and stops the current flush after a transient failure", async () => {
    const first = createDummyRequest("first", "urgent", 100);
    const second = createDummyRequest("second", "urgent", 200);
    await mockStorage.save(first);
    await mockStorage.save(second);

    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);

    const syncManager = new SyncManager(
      mockStorage,
      { retryBaseDelayMs: 1000, retryMaxDelayMs: 5000 },
      engineStub,
    );
    await syncManager.flushQueue();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    const pending = await mockStorage.getAll();
    const updatedFirst = pending.find((request) => request.id === "first");
    const untouchedSecond = pending.find((request) => request.id === "second");

    expect(updatedFirst?.retryCount).toBe(1);
    expect(updatedFirst?.nextRetryAt).toBeGreaterThan(Date.now());
    expect(untouchedSecond?.retryCount).toBe(0);
  });

  it("moves items to persisted dead letters after max retries", async () => {
    const failingRequest = createDummyRequest("fail-req", "urgent", 100);
    failingRequest.retryCount = 2;
    await mockStorage.save(failingRequest);

    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    const onDeadLetterMock = vi.fn();
    const syncManager = new SyncManager(
      mockStorage,
      {
        maxRetries: 3,
        onDeadLetter: onDeadLetterMock,
      },
      engineStub,
    );

    await syncManager.flushQueue();

    expect(onDeadLetterMock).toHaveBeenCalledTimes(1);
    expect(await mockStorage.getAll()).toHaveLength(0);
    expect(await mockStorage.getDeadLetters()).toEqual([
      expect.objectContaining({ id: "fail-req", retryCount: 3 }),
    ]);
  });
});
