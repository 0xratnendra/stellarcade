# @stellarcade/simulated-network-latency

Mock Stellar RPC proxy that injects configurable network latency and fault conditions, so
frontend/game code can be exercised against slow or flaky RPC responses without needing a
real degraded network.

## Usage

```bash
simulated-network-latency \
  --target https://soroban-testnet.stellar.org \
  --port 8899 \
  --min-latency 200 --max-latency 1500 \
  --fault-rate 0.1 --fault-status 503
```

Point your app's RPC URL at `http://localhost:8899` instead of the real endpoint. Each request is
delayed by a random amount in `[min-latency, max-latency]` and, with probability `fault-rate`,
answered with a synthetic JSON-RPC error instead of being forwarded upstream.

## Options

| Flag | Description | Default |
| --- | --- | --- |
| `--target <url>` | Upstream Soroban RPC URL (required) | — |
| `--port <number>` | Local listen port | `8899` |
| `--min-latency <ms>` / `--max-latency <ms>` | Injected latency range | `0` / `0` |
| `--fault-rate <rate>` | Fraction of requests to fail (0-1) | `0` |
| `--fault-status <code>` | HTTP status for faulted requests | `503` |
