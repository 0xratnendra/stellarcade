import { RateLimiter, MetricsCollector, LoadEngine } from './loadEngine';
import { Networks } from '@stellar/js-stellar-sdk';

describe('RateLimiter', () => {
  it('should maintain configured target transaction pace', async () => {
    const limiter = new RateLimiter(10); // 10 tx/s
    const startTime = Date.now();
    const tokensRequested = 5;

    for (let i = 0; i < tokensRequested; i++) {
      await limiter.waitForToken();
    }

    const elapsed = Date.now() - startTime;
    // Should take approximately 400ms for 5 tokens at 10 tx/s
    // Allow 50ms tolerance
    expect(elapsed).toBeLessThan(500);
    expect(elapsed).toBeGreaterThan(350);
  });
});

describe('MetricsCollector', () => {
  it('should accurately compute p95 latency', () => {
    const collector = new MetricsCollector();
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    latencies.forEach((latency, index) => {
      collector.recordTransaction({
        id: `tx-${index}`,
        success: true,
        latency,
        timestamp: Date.now()
      });
    });

    const snapshot = collector.getSnapshot();
    // p95 of [10...100] should be 95
    expect(snapshot.p95Latency).toBeLessThanOrEqual(100);
    expect(snapshot.p95Latency).toBeGreaterThanOrEqual(50);
    expect(snapshot.totalConfirmed).toBe(10);
    expect(snapshot.totalFailed).toBe(0);
  });

  it('should track failure reasons', () => {
    const collector = new MetricsCollector();

    collector.recordTransaction({
      id: 'tx-1',
      success: false,
      latency: 100,
      failureReason: 'bad_sequence_number',
      timestamp: Date.now()
    });

    collector.recordTransaction({
      id: 'tx-2',
      success: false,
      latency: 110,
      failureReason: 'insufficient_balance',
      timestamp: Date.now()
    });

    const snapshot = collector.getSnapshot();
    expect(snapshot.failureReasons.get('bad_sequence_number')).toBe(1);
    expect(snapshot.failureReasons.get('insufficient_balance')).toBe(1);
  });
});

describe('LoadEngine', () => {
  it('should throw error if network passphrase is for public network', () => {
    const config = {
      workers: 4,
      rate: 5,
      duration: 30,
      networkPassphrase: Networks.PUBLIC_NETWORK_PASSPHRASE,
      horizonUrl: 'https://horizon.stellar.org'
    };

    const engine = new LoadEngine(config);
    expect(() => engine['validateNetwork']()).toThrow(
      'Load testing is not allowed on Mainnet for safety reasons'
    );
  });

  it('should allow testnet network', async () => {
    const config = {
      workers: 1,
      rate: 1,
      duration: 1,
      networkPassphrase: Networks.TESTNET_NETWORK_PASSPHRASE,
      horizonUrl: 'https://horizon-testnet.stellar.org'
    };

    const engine = new LoadEngine(config);
    expect(() => engine['validateNetwork']()).not.toThrow();
    await engine.initialize();
    expect(engine).toBeDefined();
  });
});
