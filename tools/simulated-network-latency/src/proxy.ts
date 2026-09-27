import * as http from 'http';
import fetch from 'node-fetch';
import type { ProxyConfig, RequestLogEntry } from './types';

/**
 * Picks a latency value uniformly between config.minLatencyMs and
 * config.maxLatencyMs (inclusive).
 */
export function pickLatencyMs(config: ProxyConfig): number {
  const { minLatencyMs, maxLatencyMs } = config;
  if (maxLatencyMs <= minLatencyMs) return minLatencyMs;
  return minLatencyMs + Math.random() * (maxLatencyMs - minLatencyMs);
}

/** Returns true if this request should be faulted, per config.faultRate. */
export function shouldFault(config: ProxyConfig): boolean {
  return Math.random() < config.faultRate;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class LatencyProxy {
  private server: http.Server | null = null;
  public readonly log: RequestLogEntry[] = [];

  constructor(private readonly config: ProxyConfig) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.port, () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf-8');

    let method = 'unknown';
    try {
      method = JSON.parse(body)?.method ?? 'unknown';
    } catch {
      // non-JSON body; leave method as 'unknown'
    }

    const latencyMs = pickLatencyMs(this.config);
    await sleep(latencyMs);

    const faulted = shouldFault(this.config);
    this.log.push({ method, latencyMs, faulted, timestamp: new Date().toISOString() });

    if (faulted) {
      res.writeHead(this.config.faultStatusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Simulated network fault' },
        }),
      );
      return;
    }

    try {
      const upstream = await fetch(this.config.targetRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: `Upstream unreachable: ${(err as Error).message}` },
        }),
      );
    }
  }
}
