import { Keypair, TransactionBuilder, Networks, Operation, BASE_FEE } from '@stellar/js-stellar-sdk';
import { LoadTestConfig, MetricsSnapshot, TransactionResult, WagerTransaction } from './types';

export class RateLimiter {
  private lastTokenTime: number = Date.now();
  private tokens: number;

  constructor(private tokensPerSecond: number) {
    this.tokens = tokensPerSecond;
  }

  async waitForToken(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastTokenTime) / 1000;
    this.tokens = Math.min(this.tokensPerSecond, this.tokens + elapsed * this.tokensPerSecond);
    this.lastTokenTime = now;

    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) / this.tokensPerSecond * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.tokens = 1;
      this.lastTokenTime = Date.now();
    }
    this.tokens--;
  }
}

export class MetricsCollector {
  private results: TransactionResult[] = [];

  recordTransaction(result: TransactionResult): void {
    this.results.push(result);
  }

  getSnapshot(): MetricsSnapshot {
    const confirmed = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    const latencies = confirmed.map(r => r.latency).sort((a, b) => a - b);
    const failureReasons = new Map<string, number>();

    failed.forEach(f => {
      const reason = f.failureReason || 'unknown';
      failureReasons.set(reason, (failureReasons.get(reason) || 0) + 1);
    });

    const p50 = this.percentile(latencies, 0.5);
    const p95 = this.percentile(latencies, 0.95);
    const p99 = this.percentile(latencies, 0.99);
    const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    return {
      totalSent: this.results.length,
      totalConfirmed: confirmed.length,
      totalFailed: failed.length,
      p50Latency: p50,
      p95Latency: p95,
      p99Latency: p99,
      failureReasons,
      averageLatency: avg
    };
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
  }
}

export class LoadEngine {
  private config: LoadTestConfig;
  private rateLimiter: RateLimiter;
  private metricsCollector: MetricsCollector;
  private keypairs: Keypair[] = [];
  private isRunning: boolean = false;

  constructor(config: LoadTestConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter(config.rate);
    this.metricsCollector = new MetricsCollector();
  }

  private validateNetwork(): void {
    // Mainnet safeguard
    if (this.config.networkPassphrase === Networks.PUBLIC_NETWORK_PASSPHRASE) {
      throw new Error('Load testing is not allowed on Mainnet for safety reasons');
    }
  }

  async initialize(): Promise<void> {
    this.validateNetwork();
    // Generate keypairs or load from file
    const keypairCount = this.config.workers;
    for (let i = 0; i < keypairCount; i++) {
      this.keypairs.push(Keypair.random());
    }
  }

  async runWorker(workerId: number): Promise<void> {
    const keypair = this.keypairs[workerId % this.keypairs.length];

    while (this.isRunning) {
      await this.rateLimiter.waitForToken();

      const startTime = Date.now();
      try {
        const wager: WagerTransaction = {
          playerId: keypair.publicKey(),
          wagerAmount: Math.floor(Math.random() * 1000) + 100,
          gameId: `game-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: startTime
        };

        // Simulate transaction submission
        await this.simulateTransaction(wager);

        const latency = Date.now() - startTime;
        this.metricsCollector.recordTransaction({
          id: wager.gameId,
          success: true,
          latency,
          timestamp: startTime
        });
      } catch (error: any) {
        const latency = Date.now() - startTime;
        this.metricsCollector.recordTransaction({
          id: `error-${startTime}`,
          success: false,
          latency,
          failureReason: error.message || 'unknown_error',
          timestamp: startTime
        });
      }
    }
  }

  private async simulateTransaction(wager: WagerTransaction): Promise<void> {
    // Simulate network delay and potential failures
    const delay = Math.random() * 100 + 50; // 50-150ms
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simulate 5% failure rate for demo
    if (Math.random() < 0.05) {
      const failures = ['bad_sequence_number', 'insufficient_balance', 'timeout'];
      throw new Error(failures[Math.floor(Math.random() * failures.length)]);
    }
  }

  async start(): Promise<void> {
    this.isRunning = true;
    const workers: Promise<void>[] = [];

    for (let i = 0; i < this.config.workers; i++) {
      workers.push(this.runWorker(i));
    }

    const durationMs = this.config.duration * 1000;
    await new Promise(resolve => setTimeout(resolve, durationMs));
    this.isRunning = false;

    await Promise.all(workers);
  }

  stop(): void {
    this.isRunning = false;
  }

  getMetrics(): MetricsSnapshot {
    return this.metricsCollector.getSnapshot();
  }
}
