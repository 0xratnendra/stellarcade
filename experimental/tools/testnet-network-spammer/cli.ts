import yargs from 'yargs';
import { Networks } from '@stellar/js-stellar-sdk';
import { LoadEngine } from './loadEngine';
import { LoadTestConfig } from './types';

const argv = yargs
  .option('workers', {
    alias: 'w',
    describe: 'Number of concurrent workers',
    default: 4,
    type: 'number'
  })
  .option('rate', {
    alias: 'r',
    describe: 'Target transaction rate (tx/s)',
    default: 5,
    type: 'number'
  })
  .option('duration', {
    alias: 'd',
    describe: 'Test duration in seconds',
    default: 30,
    type: 'number'
  })
  .option('keys-file', {
    alias: 'k',
    describe: 'Path to keypairs file',
    type: 'string'
  })
  .option('network', {
    alias: 'n',
    describe: 'Network to target (testnet or local)',
    default: 'testnet',
    choices: ['testnet', 'local'],
    type: 'string'
  })
  .parseSync();

async function main() {
  const networkPassphrase = argv.network === 'testnet'
    ? Networks.TESTNET_NETWORK_PASSPHRASE
    : 'Standalone Network ; February 2017';

  const config: LoadTestConfig = {
    workers: argv.workers,
    rate: argv.rate,
    duration: argv.duration,
    keysFile: argv['keys-file'],
    networkPassphrase,
    horizonUrl: argv.network === 'testnet'
      ? 'https://horizon-testnet.stellar.org'
      : 'http://localhost:8000'
  };

  const engine = new LoadEngine(config);

  console.log('🚀 Starting load test...');
  console.log(`   Workers: ${config.workers}`);
  console.log(`   Rate: ${config.rate} tx/s`);
  console.log(`   Duration: ${config.duration}s`);
  console.log(`   Network: ${argv.network}`);

  try {
    await engine.initialize();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n⏹️  Shutting down...');
      engine.stop();
    });

    await engine.start();

    const metrics = engine.getMetrics();
    console.log('\n📊 Load Test Results:');
    console.log(`   Total Sent: ${metrics.totalSent}`);
    console.log(`   Confirmed: ${metrics.totalConfirmed}`);
    console.log(`   Failed: ${metrics.totalFailed}`);
    console.log(`   Success Rate: ${((metrics.totalConfirmed / metrics.totalSent) * 100).toFixed(2)}%`);
    console.log(`   Average Latency: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`   P50 Latency: ${metrics.p50Latency.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${metrics.p95Latency.toFixed(2)}ms`);
    console.log(`   P99 Latency: ${metrics.p99Latency.toFixed(2)}ms`);
    
    if (metrics.failureReasons.size > 0) {
      console.log('\n   Failure Breakdown:');
      metrics.failureReasons.forEach((count, reason) => {
        console.log(`     ${reason}: ${count}`);
      });
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
