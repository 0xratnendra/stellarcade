# rpc-benchmarker

A standalone CLI and library for benchmarking multiple Stellar RPC
endpoints (Soroban RPC and/or Horizon) and ranking them by latency,
jitter, request success rate, and ledger sync drift.

> **Status:** experimental, self-contained tool under `experimental/tools/`.
> It does not modify or depend on any core repo tooling.

## What it measures

For each configured endpoint, over `--rounds` rounds:

1. Sends a `getHealth` JSON-RPC request (a cheap liveness check).
2. Sends a `getLatestLedger` JSON-RPC request and records its latency and
   reported ledger sequence.

From the collected samples per endpoint, it computes:

- **p50 / p95 / p99 latency**, using nearest-rank percentiles over the
  successful samples only (a failed request's latency, e.g. a full timeout
  duration, does not pollute the latency distribution of an otherwise
  healthy endpoint).
- **Jitter**, the mean absolute round-to-round latency delta (how much
  latency swings between consecutive rounds, not just its overall spread).
- **Success rate**, the fraction of rounds that completed without error.
- **Ledger drift**, how far behind the most-advanced tested endpoint's
  reported ledger sequence this endpoint's own latest sequence is (`0` if
  it's tied for most advanced).

Endpoints are ranked fastest (lowest p50) first; a fully unresponsive
endpoint (0% success rate) always sorts last, since its latency figures
are meaningless with zero successful samples.

## Network layer

Requests are plain `node:http`/`node:https` JSON-RPC POSTs, matching this
workspace's `tools/rpc-health-daemon`'s wire pattern, rather than
depending on `@stellar/stellar-sdk`'s RPC client (none of this workspace's
`experimental/tools/*` packages depend on it). A dead, refused, or
never-responding endpoint resolves to a failed sample rather than
throwing or hanging the whole run; the per-request timeout is
configurable via `--timeout`.

## Installation

```bash
cd experimental/tools/rpc-benchmarker
npm install
npm run build
```

## Usage

```bash
rpc-benchmarker --endpoints <url1,url2,...> [--rounds 10] [--concurrency 3] [--timeout 5000] [--json]
```

- `--endpoints`: comma-separated list of RPC endpoint URLs (required).
- `--rounds`: request rounds per endpoint (default `10`).
- `--concurrency`: number of endpoints probed in parallel; probes within
  one endpoint's own rounds are always sequential (default `3`).
- `--timeout`: per-request timeout in milliseconds (default `5000`).
- `--json`: print the raw `BenchmarkReport` JSON instead of a formatted
  leaderboard table.

### Example output

```text
Rank  Endpoint                              p50    p95    p99    Jitter  Success  Ledger Drift
----  ------------------------------------  -----  -----  -----  ------  -------  ------------
1     https://soroban-rpc.example.com       42ms   58ms   61ms   3.1ms   100%     0 ledgers
2     https://soroban-testnet.example.org   88ms   140ms  155ms  12.4ms  100%     1 ledgers
3     https://dead-node.example.net         n/a    n/a    n/a    n/a     0%       n/a
```

## Library usage

```ts
import { runBenchmark, formatLeaderboard } from '@stellarcade/rpc-benchmarker';

const report = await runBenchmark({
  endpoints: ['https://rpc-a.example.com', 'https://rpc-b.example.com'],
  rounds: 10,
  concurrency: 2,
  timeoutMs: 5000,
});
console.log(formatLeaderboard(report));
```

`runBenchmark` accepts an optional third-party-injectable request function
(`RequestFn`) as its second argument, defaulting to the real network
implementation (`rpcRequest`); this is how the test suite substitutes a
fake transport for fast, deterministic ranking tests without making real
network calls.

## Testing

```bash
npm test
```

Covers latency percentile/jitter math (`stats.test.ts`), ranking and
ledger-drift computation against a fake transport, and real
timeout/connection-refused handling against actual local sockets
(`benchmark.test.ts`).
