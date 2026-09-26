import { describe, it, expect } from 'vitest';
import { computeLatencyStats } from './stats';
import { RequestSample } from '../types';

function successSample(latencyMs: number): RequestSample {
  return { latencyMs, success: true };
}

// ---------------------------------------------------------------------------
// 1. latency calculation math (p50, p95, p99)
// ---------------------------------------------------------------------------

describe('computeLatencyStats', () => {
  it('computes p50/p95/p99 correctly over 100 evenly spread samples', () => {
    // Latencies 1..100ms: nearest-rank p50 = 50th smallest = 50ms,
    // p95 = 95th smallest = 95ms, p99 = 99th smallest = 99ms.
    const samples = Array.from({ length: 100 }, (_, i) => successSample(i + 1));
    const stats = computeLatencyStats(samples);

    expect(stats.p50).toBe(50);
    expect(stats.p95).toBe(95);
    expect(stats.p99).toBe(99);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.mean).toBeCloseTo(50.5, 5);
  });

  it('computes correct percentiles for a small, out-of-order sample set', () => {
    const samples = [30, 10, 50, 20, 40].map(successSample);
    const stats = computeLatencyStats(samples);
    // sorted: 10, 20, 30, 40, 50
    expect(stats.p50).toBe(30);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
  });

  it('returns all-zero stats for an empty sample list', () => {
    const stats = computeLatencyStats([]);
    expect(stats).toEqual({ p50: 0, p95: 0, p99: 0, jitter: 0, min: 0, max: 0, mean: 0 });
  });

  it('excludes failed samples from latency statistics', () => {
    const samples: RequestSample[] = [
      successSample(10),
      { latencyMs: 5000, success: false, error: 'timeout' },
      successSample(20),
    ];
    const stats = computeLatencyStats(samples);
    expect(stats.max).toBe(20); // the 5000ms failure must not pollute stats
    expect(stats.min).toBe(10);
  });

  it('returns zero jitter for a single sample', () => {
    const stats = computeLatencyStats([successSample(42)]);
    expect(stats.jitter).toBe(0);
    expect(stats.p50).toBe(42);
  });

  it('computes jitter as the mean absolute round-to-round latency delta', () => {
    // Deltas: |20-10|=10, |10-20|=10, |30-10|=20 -> mean = 40/3
    const samples = [10, 20, 10, 30].map(successSample);
    const stats = computeLatencyStats(samples);
    expect(stats.jitter).toBeCloseTo(40 / 3, 5);
  });

  it('reports zero jitter for perfectly consistent latency', () => {
    const samples = Array.from({ length: 10 }, () => successSample(15));
    const stats = computeLatencyStats(samples);
    expect(stats.jitter).toBe(0);
  });
});
