import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { formatLeaderboard, runBenchmark, RequestFn } from './benchmark';
import { rpcRequest } from './rpc-client';
import { RequestSample } from '../types';

/** A fake requestFn returning fixed, deterministic latencies per endpoint,
 * so ranking/ordering tests don't depend on real network timing. */
function fakeRequestFn(latencyByEndpoint: Record<string, number>, failEndpoints: Set<string> = new Set()): RequestFn {
  return async (endpoint: string, method: string): Promise<RequestSample> => {
    if (failEndpoints.has(endpoint)) {
      return { latencyMs: 0, success: false, error: 'simulated failure' };
    }
    const latencyMs = latencyByEndpoint[endpoint] ?? 0;
    const ledgerSequence = method === 'getLatestLedger' ? 1000 : undefined;
    return { latencyMs, success: true, ledgerSequence };
  };
}

// ---------------------------------------------------------------------------
// 2. endpoint ranking sorts fastest first
// ---------------------------------------------------------------------------

describe('runBenchmark ranking', () => {
  it('sorts endpoints fastest (lowest p50) first', async () => {
    const requestFn = fakeRequestFn({
      'http://slow.example': 300,
      'http://fast.example': 10,
      'http://medium.example': 100,
    });

    const report = await runBenchmark(
      { endpoints: ['http://slow.example', 'http://fast.example', 'http://medium.example'], rounds: 3, concurrency: 3, timeoutMs: 1000 },
      requestFn
    );

    expect(report.results.map((r) => r.endpoint)).toEqual([
      'http://fast.example',
      'http://medium.example',
      'http://slow.example',
    ]);
  });

  it('always sorts fully unresponsive endpoints last, regardless of any latency data', async () => {
    const requestFn = fakeRequestFn(
      { 'http://working.example': 500 }, // deliberately "slow" but working
      new Set(['http://dead.example'])
    );

    const report = await runBenchmark(
      { endpoints: ['http://dead.example', 'http://working.example'], rounds: 2, concurrency: 2, timeoutMs: 1000 },
      requestFn
    );

    expect(report.results[0].endpoint).toBe('http://working.example');
    expect(report.results[1].endpoint).toBe('http://dead.example');
    expect(report.results[1].unresponsive).toBe(true);
  });

  it('computes ledger drift relative to the most-advanced endpoint', async () => {
    const requestFn: RequestFn = async (endpoint: string, method: string): Promise<RequestSample> => {
      if (method !== 'getLatestLedger') return { latencyMs: 1, success: true };
      const sequence = endpoint === 'http://ahead.example' ? 1000 : 950;
      return { latencyMs: 1, success: true, ledgerSequence: sequence };
    };

    const report = await runBenchmark(
      { endpoints: ['http://ahead.example', 'http://behind.example'], rounds: 1, concurrency: 2, timeoutMs: 1000 },
      requestFn
    );

    const ahead = report.results.find((r) => r.endpoint === 'http://ahead.example')!;
    const behind = report.results.find((r) => r.endpoint === 'http://behind.example')!;
    expect(ahead.ledgerDriftFromMax).toBe(0);
    expect(behind.ledgerDriftFromMax).toBe(50);
  });

  it('rejects an empty endpoint list', async () => {
    await expect(runBenchmark({ endpoints: [], rounds: 1, concurrency: 1, timeoutMs: 1000 })).rejects.toThrow(
      /at least one endpoint/i
    );
  });

  it('rejects a non-positive rounds or concurrency value', async () => {
    const requestFn = fakeRequestFn({ 'http://a.example': 1 });
    await expect(
      runBenchmark({ endpoints: ['http://a.example'], rounds: 0, concurrency: 1, timeoutMs: 1000 }, requestFn)
    ).rejects.toThrow(/rounds/);
    await expect(
      runBenchmark({ endpoints: ['http://a.example'], rounds: 1, concurrency: 0, timeoutMs: 1000 }, requestFn)
    ).rejects.toThrow(/concurrency/);
  });
});

// ---------------------------------------------------------------------------
// 3. timeout detection on dead endpoints
// ---------------------------------------------------------------------------

describe('timeout detection', () => {
  it('marks an endpoint that never responds as unresponsive without throwing', async () => {
    // A server that accepts the connection but never writes a response,
    // forcing the client-side timeout path in rpc-client.ts.
    const server = http.createServer(() => {
      /* never respond */
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const report = await runBenchmark(
        { endpoints: [`http://127.0.0.1:${port}`], rounds: 1, concurrency: 1, timeoutMs: 200 },
        rpcRequest
      );
      expect(report.results).toHaveLength(1);
      expect(report.results[0].unresponsive).toBe(true);
      expect(report.results[0].samples[0].success).toBe(false);
      expect(report.results[0].samples[0].error).toMatch(/timed out/i);
    } finally {
      server.close();
    }
  }, 10_000);

  it('handles a connection refused endpoint gracefully', async () => {
    // Port 1 is a reserved/unlikely-to-be-listening port; connection should
    // be refused quickly rather than hanging or crashing the process.
    const report = await runBenchmark(
      { endpoints: ['http://127.0.0.1:1'], rounds: 1, concurrency: 1, timeoutMs: 1000 },
      rpcRequest
    );
    expect(report.results[0].unresponsive).toBe(true);
  });

  it('does not let one dead endpoint prevent other endpoints from being benchmarked', async () => {
    const requestFn = fakeRequestFn({ 'http://ok.example': 42 }, new Set(['http://dead.example']));
    const report = await runBenchmark(
      { endpoints: ['http://dead.example', 'http://ok.example'], rounds: 2, concurrency: 2, timeoutMs: 500 },
      requestFn
    );
    const ok = report.results.find((r) => r.endpoint === 'http://ok.example')!;
    expect(ok.unresponsive).toBe(false);
    expect(ok.stats.p50).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// leaderboard formatting
// ---------------------------------------------------------------------------

describe('formatLeaderboard', () => {
  it('renders a table with a rank column and every endpoint', async () => {
    const requestFn = fakeRequestFn({ 'http://a.example': 10, 'http://b.example': 50 });
    const report = await runBenchmark(
      { endpoints: ['http://b.example', 'http://a.example'], rounds: 2, concurrency: 2, timeoutMs: 1000 },
      requestFn
    );
    const table = formatLeaderboard(report);
    expect(table).toContain('http://a.example');
    expect(table).toContain('http://b.example');
    expect(table.indexOf('http://a.example')).toBeLessThan(table.indexOf('http://b.example'));
  });
});
