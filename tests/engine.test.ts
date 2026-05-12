import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiomEngine } from '../src/engine/fetcher';
import { MemoryStorageAdapter } from '../src/adapters/memory';
import { AxiomConfig } from '../src/types';

describe('AxiomEngine Core', () => {
  let engine: AxiomEngine;
  let mockStorage: MemoryStorageAdapter;

  beforeEach(() => {
    mockStorage = new MemoryStorageAdapter();
    engine = new AxiomEngine();
    
    // Reset the global fetch mock before every test
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully make a POST request without queuing', async () => {
    // Mock a successful 200 OK response
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    engine.create({ baseURL: 'https://api.test.com' }, mockStorage);
    
    const response = await engine.post<{ success: boolean }>('/data', { foo: 'bar' });

    expect(response.status).toBe(200);
    expect(response.isQueued).toBe(false);
    expect(response.data?.success).toBe(true);
    
    // Ensure nothing was queued
    const pending = await mockStorage.getAll();
    expect(pending.length).toBe(0);
  });

  it('should queue the request if the network drops (throws error)', async () => {
    // Mock a network failure (fetch throws)
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network request failed'));

    engine.create({}, mockStorage);
    const response = await engine.post('/data', { foo: 'bar' });

    expect(response.status).toBe(202);
    expect(response.isQueued).toBe(true);

    const pending = await mockStorage.getAll();
    expect(pending.length).toBe(1);
    expect(pending[0].method).toBe('POST');
    expect(JSON.parse(pending[0].body!)).toEqual({ foo: 'bar' });
  });

  it('should queue the request on a timeout', async () => {
    // Mock a fetch that takes forever (simulating a timeout)
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 1000)));

    engine.create({}, mockStorage);
    
    // Set an aggressively short timeout of 10ms for the test
    const response = await engine.get('/data', { timeout: 10 });

    expect(response.status).toBe(202);
    expect(response.isQueued).toBe(true);

    const pending = await mockStorage.getAll();
    expect(pending.length).toBe(1);
    expect(pending[0].method).toBe('GET');
  });

  it('should trigger the global onResponse interceptor on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ interceptMe: true }),
    } as Response);

    const onResponseMock = vi.fn();
    engine.create({ onResponse: onResponseMock }, mockStorage);

    await engine.get('/test');

    expect(onResponseMock).toHaveBeenCalledTimes(1);
    expect(onResponseMock).toHaveBeenCalledWith(
      { interceptMe: true }, // The data
      200,                   // The status
      expect.objectContaining({ url: '/test', method: 'GET' }) // The request
    );
  });

  it('should trigger the global onError interceptor on a 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const onErrorMock = vi.fn();
    engine.create({ onError: onErrorMock }, mockStorage);

    const response = await engine.get('/missing');

    // 404s shouldn't queue, they should just fail immediately
    expect(response.isQueued).toBe(false); 
    expect(onErrorMock).toHaveBeenCalledTimes(1);
    expect(onErrorMock).toHaveBeenCalledWith(
      404, 
      expect.any(Error), 
      expect.objectContaining({ url: '/missing' })
    );
  });
});