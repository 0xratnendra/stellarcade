import { BenchmarkOptions, BenchmarkReport, EndpointResult, RequestSample } from '../types';
import { rpcRequest } from './rpc-client';
import { computeLatencyStats } from './stats';

/** Injectable so tests can substitute a fake transport instead of making
 * real network calls; the real CLI wires this to `rpcRequest`. */
export type RequestFn = (endpoint: string, method: string, timeoutMs: number) => Promise<RequestSample>;

async function probeEndpoint(
  endpoint: string,
  rounds: number,
  timeoutMs: number,
  requestFn: RequestFn
): Promise<RequestSample[]> {
  const samples: RequestSample[] = [];
  for (let i = 0; i < rounds; i++) {
    // getHealth first (cheap liveness check); getLatestLedger is what
    // actually reports a ledger sequence for drift calculation. Both count
    // as one "round" against this endpoint.
    await requestFn(endpoint, 'getHealth', timeoutMs);
    const ledgerSample = await requestFn(endpoint, 'getLatestLedger', timeoutMs);
    samples.push(ledgerSample);
  }
  return samples;
}

function buildEndpointResult(endpoint: string, samples: RequestSample[]): EndpointResult {
  const successCount = samples.filter((s) => s.success).length;
  const failureCount = samples.length - successCount;
  const successRate = samples.length > 0 ? successCount / samples.length : 0;
  const stats = computeLatencyStats(samples);

  const latestLedgerSequence = samples.reduce<number | null>((max, s) => {
    if (s.success && typeof s.ledgerSequence === 'number') {
      return max === null ? s.ledgerSequence : Math.max(max, s.ledgerSequence);
    }
    return max;
  }, null);

  return {
    endpoint,
    samples,
    successCount,
    failureCount,
    successRate,
    stats,
    latestLedgerSequence,
    // Filled in by runBenchmark once every endpoint's result is known.
    ledgerDriftFromMax: null,
    unresponsive: successCount === 0,
  };
}

/**
 * Run the full benchmark across every configured endpoint, respecting
 * `concurrency` (how many endpoints are probed in parallel at once; probes
 * WITHIN one endpoint's `rounds` are always sequential, since round N's
 * latency should reflect one request in flight at a time, not contention
 * with round N+1). Ranks results fastest (lowest p50) first, with fully
 * unresponsive endpoints always sorted last.
 */
export async function runBenchmark(options: BenchmarkOptions, requestFn: RequestFn = rpcRequest): Promise<BenchmarkReport> {
  if (options.endpoints.length === 0) {
    throw new Error('At least one endpoint is required');
  }
  if (options.rounds <= 0) {
    throw new Error('rounds must be positive');
  }
  if (options.concurrency <= 0) {
    throw new Error('concurrency must be positive');
  }

  const results: EndpointResult[] = new Array(options.endpoints.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < options.endpoints.length) {
      const index = nextIndex++;
      const endpoint = options.endpoints[index];
      const samples = await probeEndpoint(endpoint, options.rounds, options.timeoutMs, requestFn);
      results[index] = buildEndpointResult(endpoint, samples);
    }
  }

  const workerCount = Math.min(options.concurrency, options.endpoints.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const maxSequence = results.reduce<number | null>((max, r) => {
    if (r.latestLedgerSequence === null) return max;
    return max === null ? r.latestLedgerSequence : Math.max(max, r.latestLedgerSequence);
  }, null);

  for (const result of results) {
    result.ledgerDriftFromMax =
      maxSequence !== null && result.latestLedgerSequence !== null ? maxSequence - result.latestLedgerSequence : null;
  }

  const ranked = [...results].sort((a, b) => {
    if (a.unresponsive !== b.unresponsive) return a.unresponsive ? 1 : -1;
    return a.stats.p50 - b.stats.p50;
  });

  return { options, results: ranked, generatedAt: new Date().toISOString() };
}

export function formatLeaderboard(report: BenchmarkReport): string {
  const header = ['Rank', 'Endpoint', 'p50', 'p95', 'p99', 'Jitter', 'Success', 'Ledger Drift'];
  const rows = report.results.map((r, i) => [
    String(i + 1),
    r.endpoint,
    r.unresponsive ? 'n/a' : `${r.stats.p50}ms`,
    r.unresponsive ? 'n/a' : `${r.stats.p95}ms`,
    r.unresponsive ? 'n/a' : `${r.stats.p99}ms`,
    r.unresponsive ? 'n/a' : `${r.stats.jitter.toFixed(1)}ms`,
    `${(r.successRate * 100).toFixed(0)}%`,
    r.ledgerDriftFromMax === null ? 'n/a' : `${r.ledgerDriftFromMax} ledgers`,
  ]);

  const widths = header.map((h, col) => Math.max(h.length, ...rows.map((row) => row[col].length)));
  const formatRow = (row: string[]) => row.map((cell, col) => cell.padEnd(widths[col])).join('  ');

  return [formatRow(header), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(formatRow)].join('\n');
}
