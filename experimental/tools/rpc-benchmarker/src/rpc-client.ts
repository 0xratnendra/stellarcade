import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { JsonRpcRequest, JsonRpcResponse, RequestSample } from '../types';

let requestId = 0;

/**
 * POST a single JSON-RPC request to `endpoint` and measure round-trip
 * latency. Mirrors `tools/rpc-health-daemon`'s raw `http`/`https` POST
 * pattern rather than depending on `@stellar/stellar-sdk`'s RPC client
 * (none of this workspace's `experimental/tools/*` packages depend on it).
 *
 * Never throws: a network error, non-2xx status, malformed JSON, or
 * timeout all resolve to `{ success: false, error }` so a caller can
 * benchmark a list of endpoints without one dead endpoint aborting the
 * whole run.
 */
export function rpcRequest(endpoint: string, method: string, timeoutMs: number): Promise<RequestSample> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const settle = (sample: RequestSample) => {
      if (settled) return;
      settled = true;
      resolve(sample);
    };

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      settle({ latencyMs: Date.now() - start, success: false, error: `Invalid endpoint URL: ${endpoint}` });
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const body: JsonRpcRequest = { jsonrpc: '2.0', id: ++requestId, method };
    const payload = JSON.stringify(body);

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          const latencyMs = Date.now() - start;
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            settle({ latencyMs, success: false, error: `HTTP ${res.statusCode}` });
            return;
          }
          try {
            const parsed: JsonRpcResponse<Record<string, unknown>> = JSON.parse(data);
            if (parsed.error) {
              settle({ latencyMs, success: false, error: parsed.error.message });
              return;
            }
            const sequence =
              method === 'getLatestLedger' && parsed.result
                ? Number((parsed.result as Record<string, unknown>).sequence)
                : undefined;
            settle({ latencyMs, success: true, ledgerSequence: Number.isFinite(sequence) ? sequence : undefined });
          } catch (err) {
            settle({ latencyMs, success: false, error: `Invalid JSON response: ${(err as Error).message}` });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      settle({ latencyMs: Date.now() - start, success: false, error: `Timed out after ${timeoutMs}ms` });
    });

    req.on('error', (err) => {
      settle({ latencyMs: Date.now() - start, success: false, error: err.message });
    });

    req.write(payload);
    req.end();
  });
}
