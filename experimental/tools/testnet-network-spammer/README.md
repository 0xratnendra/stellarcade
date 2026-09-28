# Testnet Network Spammer - Load Test CLI

A multi-worker load testing CLI tool that simulates concurrent arcade wager transactions on the Stellar testnet to benchmark transaction throughput and detect race conditions.

## Features

- **Multi-worker load generation**: Spawn configurable concurrent workers
- **Rate limiting**: Control transaction throughput (tx/s)
- **Comprehensive metrics**: Track latency (p50/p95/p99), success rates, and failure types
- **Mainnet safeguard**: Prevents accidental testing on Mainnet
- **Graceful shutdown**: Clean exit and worker termination on Ctrl+C

## Installation

```bash
cd experimental/tools/testnet-network-spammer
npm install
npm run build
```

## Usage

### Basic Example

```bash
ts-node cli.ts --workers 8 --rate 10 --duration 60
```

### CLI Flags

- `--workers, -w` (default: 4): Number of concurrent workers
- `--rate, -r` (default: 5): Target transaction rate in tx/s
- `--duration, -d` (default: 30): Test duration in seconds
- `--keys-file, -k`: Path to keypairs file (optional)
- `--network, -n` (default: testnet): Network to target ('testnet' or 'local')

### Advanced Example

```bash
ts-node cli.ts \
  --workers 16 \
  --rate 50 \
  --duration 120 \
  --network testnet
```

## Output

The tool provides a summary report with:

- Total transactions sent
- Transaction confirmation count
- Transaction failure count
- Success rate percentage
- Average latency
- P50, P95, P99 latency percentiles
- Breakdown of failure reasons (bad sequence number, insufficient balance, timeout)

## Testing

```bash
npm test
```

Test coverage includes:
- Rate limiter maintains configured target pace
- Metrics collector accurately computes p95 latency
- Mainnet safeguard throws error for public network

## Safety

This tool is intentionally restricted to Testnet and local standalone networks. Attempting to run against Mainnet will result in an immediate error.
