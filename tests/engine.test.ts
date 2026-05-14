import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AxiomEngine } from "../src/engine/fetcher";
import { MemoryStorageAdapter } from "../src/adapters/memory";

describe("AxiomEngine Core", () => {
  let engine: AxiomEngine;
  let mockStorage: MemoryStorageAdapter;

  beforeEach(() => {
    mockStorage = new MemoryStorageAdapter();
    engine = new AxiomEngine();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("makes a successful POST request without queuing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    engine.create({ baseURL: "https://api.test.com" }, mockStorage);

    const response = await engine.post<{ success: boolean }>("/data", {
      foo: "bar",
    });

    expect(response.status).toBe(200);
    expect(response.isQueued).toBe(false);
    expect(response.data?.success).toBe(true);
    expect(await mockStorage.getAll()).toHaveLength(0);
  });

  it("queues mutation requests if the network drops", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Network request failed"));

    engine.create({}, mockStorage);
    const response = await engine.post("/data", { foo: "bar" });

    expect(response.status).toBe(202);
    expect(response.isQueued).toBe(true);

    const pending = await mockStorage.getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0].method).toBe("POST");
    expect(pending[0].idempotencyKey).toBeTruthy();
    expect(JSON.parse(pending[0].body!)).toEqual({ foo: "bar" });
  });

  it("does not queue GET requests by default", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));

    engine.create({}, mockStorage);
    const response = await engine.get("/data");

    expect(response.isQueued).toBe(false);
    expect(await mockStorage.getAll()).toHaveLength(0);
  });

  it("queues GET requests only when queueReads is enabled", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));

    engine.create({ queueReads: true }, mockStorage);
    const response = await engine.get("/data");

    expect(response.isQueued).toBe(true);
    expect(await mockStorage.getAll()).toHaveLength(1);
  });

  it("drops duplicate queued mutations using the dedupe key", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("offline"));

    engine.create({}, mockStorage);

    await engine.post("/orders", { id: 1 }, { idempotencyKey: "order-1" });
    await engine.post("/orders", { id: 1 }, { idempotencyKey: "order-1" });

    const pending = await mockStorage.getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0].idempotencyKey).toBe("order-1");
  });

  it("triggers the global onResponse interceptor on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ interceptMe: true }),
    } as Response);

    const onResponseMock = vi.fn();
    engine.create({ onResponse: onResponseMock }, mockStorage);

    await engine.get("/test", { headers: { Accept: "application/json" } });

    expect(onResponseMock).toHaveBeenCalledTimes(1);
    expect(onResponseMock).toHaveBeenCalledWith(
      { interceptMe: true },
      200,
      expect.objectContaining({ url: "/test", method: "GET" }),
    );
  });

  it("automatically retries queued requests when the backoff window expires", async () => {
    vi.useFakeTimers();

    const now = new Date("2026-05-14T10:00:00.000Z");
    vi.setSystemTime(now);

    await mockStorage.save({
      id: "retry-me",
      timestamp: now.getTime(),
      url: "/retry-me",
      method: "POST",
      headers: {},
      body: JSON.stringify({ ok: true }),
      priority: "urgent",
      retryCount: 1,
      nextRetryAt: now.getTime() + 1_000,
      timeoutMs: 5_000,
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ synced: true }),
    } as Response);

    engine.create({}, mockStorage);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(await mockStorage.getAll()).toHaveLength(0);
  });

  it("schedules retries for freshly queued 5xx responses", async () => {
    vi.useFakeTimers();

    const now = new Date("2026-05-14T10:00:00.000Z");
    vi.setSystemTime(now);

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ recovered: true }),
      } as Response);

    engine.create({ retryBaseDelayMs: 1000, retryJitter: 0 }, mockStorage);

    const response = await engine.post("/recover", { foo: "bar" });
    expect(response.isQueued).toBe(true);

    const pending = await mockStorage.getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0].retryCount).toBe(1);
    expect(pending[0].nextRetryAt).toBe(now.getTime() + 1000);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(await mockStorage.getAll()).toHaveLength(0);
  });
});
