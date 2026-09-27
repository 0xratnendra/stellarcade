#!/usr/bin/env node

import { Command } from 'commander';
import { formatLeaderboard, runBenchmark } from './benchmark';

const program = new Command();

program
  .name('rpc-benchmarker')
  .description('Benchmark and rank multiple Stellar RPC endpoints by latency, jitter, and ledger sync drift.')
  .version('0.0.1')
  .requiredOption('--endpoints <urls>', 'Comma-separated list of RPC endpoint URLs')
  .option('--rounds <n>', 'Number of request rounds per endpoint', '10')
  .option('--concurrency <n>', 'Number of endpoints probed in parallel', '3')
  .option('--timeout <ms>', 'Per-request timeout, in milliseconds', '5000')
  .option('--json', 'Output the raw JSON report instead of a formatted leaderboard', false)
  .action(async (options) => {
    const endpoints = String(options.endpoints)
      .split(',')
      .map((e: string) => e.trim())
      .filter((e: string) => e.length > 0);

    if (endpoints.length === 0) {
      console.error('Error: --endpoints must contain at least one URL');
      process.exitCode = 2;
      return;
    }

    const rounds = parseInt(options.rounds, 10);
    const concurrency = parseInt(options.concurrency, 10);
    const timeoutMs = parseInt(options.timeout, 10);
    if (!Number.isFinite(rounds) || !Number.isFinite(concurrency) || !Number.isFinite(timeoutMs)) {
      console.error('Error: --rounds, --concurrency, and --timeout must be numbers');
      process.exitCode = 2;
      return;
    }

    try {
      const report = await runBenchmark({ endpoints, rounds, concurrency, timeoutMs });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatLeaderboard(report));
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv);
}

export { runBenchmark, formatLeaderboard } from './benchmark';
export { computeLatencyStats } from './stats';
export { rpcRequest } from './rpc-client';
export * from '../types';
