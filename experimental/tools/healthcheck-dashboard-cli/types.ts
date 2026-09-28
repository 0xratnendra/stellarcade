export type EndpointType = 'soroban' | 'horizon' | 'backend';

export type EndpointHealthState = 'operational' | 'degraded' | 'down';

export interface HealthEndpointConfig {
  id: string;
  name: string;
  url: string;
  type: EndpointType;
  description?: string;
}

export interface HealthStatusRecord {
  endpointId: string;
  name: string;
  type: EndpointType;
  status: EndpointHealthState;
  latencyMs: number;
  httpStatus: number | null;
  ledgerSequence?: number | null;
  syncLag?: number | null;
  timestamp: string;
  sparkline: number[];
}

export interface HealthSnapshot {
  results: HealthStatusRecord[];
  generatedAt: string;
}

export interface HealthPollerOptions {
  intervalMs?: number;
  requestTimeoutMs?: number;
  maxSparklinePoints?: number;
}
