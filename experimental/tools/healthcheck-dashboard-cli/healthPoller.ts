import { HealthEndpointConfig, HealthPollerOptions, HealthSnapshot, HealthStatusRecord } from './types';

export class HealthPoller {
  private readonly configs: HealthEndpointConfig[];
  private readonly intervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxSparklinePoints: number;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly history = new Map<string, number[]>();

  constructor(configs: HealthEndpointConfig[], options: HealthPollerOptions = {}) {
    this.configs = configs;
    this.intervalMs = options.intervalMs ?? 5000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3000;
    this.maxSparklinePoints = options.maxSparklinePoints ?? 20;
  }

  public async pollOnce(): Promise<HealthSnapshot> {
    const results = await Promise.all(this.configs.map((endpoint) => this.pollEndpoint(endpoint)));

    return {
      results,
      generatedAt: new Date().toISOString(),
    };
  }

  public start(onTick?: (snapshot: HealthSnapshot) => void): void {
    if (this.intervalId) {
      return;
    }

    const tick = async () => {
      const snapshot = await this.pollOnce();
      onTick?.(snapshot);
    };

    void tick();
    this.intervalId = setInterval(() => {
      void tick();
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async pollEndpoint(config: HealthEndpointConfig): Promise<HealthStatusRecord> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(config.url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      const latencyMs = Date.now() - startedAt;
      const nextHistory = this.recordHistory(config.id, latencyMs);

      const raw = await response.text();
      let parsed: any = null;

      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }

      const ledgerSequence =
        parsed && typeof parsed.ledgerSequence === 'number'
          ? parsed.ledgerSequence
          : parsed && typeof parsed.sequence === 'number'
            ? parsed.sequence
            : parsed && typeof parsed.ledger === 'number'
              ? parsed.ledger
              : null;

      const syncLag =
        parsed && typeof parsed.syncLag === 'number'
          ? parsed.syncLag
          : parsed && typeof parsed.sync_difference === 'number'
            ? parsed.sync_difference
            : parsed && typeof parsed.syncDifference === 'number'
              ? parsed.syncDifference
              : null;

      return {
        endpointId: config.id,
        name: config.name,
        type: config.type,
        status: this.getStatus(response.status, latencyMs),
        latencyMs,
        httpStatus: response.status,
        ledgerSequence,
        syncLag,
        timestamp: new Date().toISOString(),
        sparkline: nextHistory,
      };
    } catch {
      const latencyMs = Date.now() - startedAt;
      const nextHistory = this.recordHistory(config.id, latencyMs);

      return {
        endpointId: config.id,
        name: config.name,
        type: config.type,
        status: 'down',
        latencyMs,
        httpStatus: null,
        ledgerSequence: null,
        syncLag: null,
        timestamp: new Date().toISOString(),
        sparkline: nextHistory,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordHistory(endpointId: string, latencyMs: number): number[] {
    const existing = this.history.get(endpointId) ?? [];
    const nextHistory = [...existing, latencyMs].slice(-this.maxSparklinePoints);
    this.history.set(endpointId, nextHistory);
    return nextHistory;
  }

  private getStatus(httpStatus: number | null, latencyMs: number): HealthStatusRecord['status'] {
    if (httpStatus === null) {
      return 'down';
    }

    if (httpStatus >= 200 && httpStatus < 300) {
      return latencyMs > 1500 ? 'degraded' : 'operational';
    }

    if (httpStatus >= 500) {
      return 'degraded';
    }

    if (httpStatus >= 400) {
      return 'down';
    }

    return 'degraded';
  }
}
