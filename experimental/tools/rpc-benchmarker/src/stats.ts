import { LatencyStats, RequestSample } from '../types';

/** Nearest-rank percentile over a sorted ascending array. `p` in [0, 100]. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

/**
 * Latency statistics (p50/p95/p99/jitter/min/max/mean) over only the
 * SUCCESSFUL samples' latencies. A caller with zero successful samples gets
 * an all-zero stats object rather than NaN/Infinity, since "no data" and
 * "zero latency" both need to render sensibly in a report table.
 */
export function computeLatencyStats(samples: RequestSample[]): LatencyStats {
  const latencies = samples.filter((s) => s.success).map((s) => s.latencyMs);

  if (latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0, jitter: 0, min: 0, max: 0, mean: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const mean = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;

  // Jitter: mean absolute deviation of consecutive-round latency deltas, in
  // the ORIGINAL (round) order, not the sorted order, since jitter measures
  // round-to-round variability, which sorting would destroy.
  let jitter = 0;
  if (latencies.length > 1) {
    let totalDelta = 0;
    for (let i = 1; i < latencies.length; i++) {
      totalDelta += Math.abs(latencies[i] - latencies[i - 1]);
    }
    jitter = totalDelta / (latencies.length - 1);
  }

  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    jitter,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
  };
}
