import { describe, it, expect, vi } from 'vitest';
import { pickLatencyMs, shouldFault } from '../proxy';
import type { ProxyConfig } from '../types';

const baseConfig: ProxyConfig = {
  targetRpcUrl: 'https://example.org',
  port: 0,
  minLatencyMs: 100,
  maxLatencyMs: 200,
  faultRate: 0,
  faultStatusCode: 503,
};

describe('pickLatencyMs', () => {
  it('returns a value within [min, max]', () => {
    for (let i = 0; i < 50; i++) {
      const ms = pickLatencyMs(baseConfig);
      expect(ms).toBeGreaterThanOrEqual(100);
      expect(ms).toBeLessThanOrEqual(200);
    }
  });

  it('returns minLatencyMs when max <= min', () => {
    expect(pickLatencyMs({ ...baseConfig, minLatencyMs: 50, maxLatencyMs: 50 })).toBe(50);
  });
});

describe('shouldFault', () => {
  it('never faults at faultRate 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0001);
    expect(shouldFault({ ...baseConfig, faultRate: 0 })).toBe(false);
    vi.restoreAllMocks();
  });

  it('always faults at faultRate 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(shouldFault({ ...baseConfig, faultRate: 1 })).toBe(true);
    vi.restoreAllMocks();
  });
});
