import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthPoller } from './healthPoller';
import { HealthEndpointConfig } from './types';

describe('HealthPoller', () => {
  const endpoints: HealthEndpointConfig[] = [
    { id: 'soroban-testnet', name: 'Soroban Testnet', url: 'https://example.test/soroban', type: 'soroban' },
    { id: 'horizon', name: 'Horizon', url: 'https://example.test/horizon', type: 'horizon' },
  ];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records latency and status codes', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ledgerSequence: 123, syncDifference: 2 }),
    } as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ledgerSequence: 456, syncDifference: 3 }),
    } as Response);

    const poller = new HealthPoller(endpoints, { intervalMs: 1000, requestTimeoutMs: 2000 });
    const snapshot = await poller.pollOnce();

    expect(snapshot.results[0].status).toBe('operational');
    expect(snapshot.results[0].httpStatus).toBe(200);
    expect(snapshot.results[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.results[0].ledgerSequence).toBe(123);
  });

  it('marks down endpoints with red status', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const poller = new HealthPoller(
      [{ id: 'backend', name: 'Backend API', url: 'https://example.test/down', type: 'backend' }],
      { intervalMs: 1000, requestTimeoutMs: 500 }
    );

    const snapshot = await poller.pollOnce();

    expect(snapshot.results[0].status).toBe('down');
    expect(snapshot.results[0].httpStatus).toBeNull();
    expect(snapshot.results[0].sparkline.length).toBeGreaterThan(0);
  });

  it('triggers scheduled polls on interval', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ledgerSequence: 11 }),
    } as Response);

    const poller = new HealthPoller(endpoints, { intervalMs: 1000, requestTimeoutMs: 2000 });
    const callback = vi.fn();

    poller.start(callback);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(callback).toHaveBeenCalledTimes(3);

    poller.stop();
    vi.useRealTimers();
  });
});
