/**
 * Shared types for the multi-RPC Soroban/Horizon endpoint benchmarker.
 */

export interface BenchmarkOptions {
  /** RPC endpoint URLs to test. */
  endpoints: string[];
  /** Number of request rounds per endpoint. */
  rounds: number;
  /** Number of endpoints probed concurrently at once. */
  concurrency: number;
  /** Per-request timeout, in milliseconds. */
  timeoutMs: number;
}

/** A single request's outcome against one endpoint. */
export interface RequestSample {
  latencyMs: number;
  success: boolean;
  error?: string;
  /** Ledger sequence returned by `getLatestLedger`, if the request succeeded. */
  ledgerSequence?: number;
}

/** Latency percentile/statistics summary computed from a set of samples. */
export interface LatencyStats {
  p50: number;
  p95: number;
  p99: number;
  /** Mean absolute deviation of consecutive-sample latency deltas: how much
   * latency varies round to round, not just its overall spread. */
  jitter: number;
  min: number;
  max: number;
  mean: number;
}

export interface EndpointResult {
  endpoint: string;
  samples: RequestSample[];
  successCount: number;
  failureCount: number;
  successRate: number;
  stats: LatencyStats;
  /** Most recent successfully observed ledger sequence, or null if every
   * request to this endpoint failed. */
  latestLedgerSequence: number | null;
  /** How far behind the highest ledger sequence seen across ALL tested
   * endpoints this endpoint's own latest sequence is (0 = in sync, or this
   * endpoint IS the most advanced). Null if this endpoint never
   * successfully reported a sequence. */
  ledgerDriftFromMax: number | null;
  /** True if every request to this endpoint failed (fully unresponsive). */
  unresponsive: boolean;
}

export interface BenchmarkReport {
  options: BenchmarkOptions;
  /** Ranked fastest (lowest p50 latency) first. Unresponsive endpoints
   * (successRate === 0) always sort last, regardless of latency stats
   * (which are meaningless with zero successful samples). */
  results: EndpointResult[];
  generatedAt: string;
}

/** Minimal JSON-RPC request/response shape used against Soroban RPC's
 * `getHealth` / `getLatestLedger` methods (see README for the wire
 * format), matching this workspace's `tools/rpc-health-daemon`. */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: { code: number; message: string };
}
