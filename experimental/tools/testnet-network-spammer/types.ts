export interface LoadTestConfig {
  workers: number;
  rate: number; // transactions per second
  duration: number; // seconds
  keysFile?: string;
  networkPassphrase: string;
  horizonUrl: string;
}

export interface WagerTransaction {
  playerId: string;
  wagerAmount: number;
  gameId: string;
  timestamp: number;
}

export interface MetricsSnapshot {
  totalSent: number;
  totalConfirmed: number;
  totalFailed: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  failureReasons: Map<string, number>;
  averageLatency: number;
}

export interface TransactionResult {
  id: string;
  success: boolean;
  latency: number;
  failureReason?: string;
  timestamp: number;
}
