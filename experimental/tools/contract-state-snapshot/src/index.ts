#!/usr/bin/env node

import * as fs from 'fs';
import { Command } from 'commander';
import { rpc, StrKey } from '@stellar/stellar-sdk';
import { captureSnapshot, makeRpcFetcher } from './snapshot';
import { diffSnapshots, formatDiff } from './diff';
import { ContractSnapshot, StorageDurability } from '../types';

function loadSnapshot(path: string): ContractSnapshot {
  return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

const program = new Command();

program
  .name('contract-state-snapshot')
  .description('Dump and diff Soroban contract instance and persistent storage entries.');

program
  .command('snapshot', { isDefault: true })
  .description('Capture a snapshot of a contract\'s instance storage, plus any explicitly requested keys')
  .requiredOption('--rpc <url>', 'Soroban RPC endpoint URL')
  .requiredOption('--contract-id <id>', 'Contract ID (C... strkey)')
  .option('--output <file>', 'Write the snapshot JSON to this file instead of stdout')
  .option('--keys <symbols>', 'Comma-separated list of persistent/temporary storage key Symbols to fetch', '')
  .option('--durability <kind>', 'Durability of the keys in --keys: persistent or temporary', 'persistent')
  .action(async (options) => {
    if (!StrKey.isValidContract(options.contractId)) {
      console.error(`Error: invalid contract ID: ${options.contractId}`);
      process.exitCode = 2;
      return;
    }

    const durability = options.durability as StorageDurability;
    if (durability !== 'persistent' && durability !== 'temporary') {
      console.error('Error: --durability must be "persistent" or "temporary"');
      process.exitCode = 2;
      return;
    }

    const keys = String(options.keys)
      .split(',')
      .map((k: string) => k.trim())
      .filter((k: string) => k.length > 0);

    try {
      const server = new rpc.Server(options.rpc);
      const snapshot = await captureSnapshot(options.contractId, options.rpc, keys, durability, makeRpcFetcher(server));
      const json = JSON.stringify(snapshot, null, 2);

      if (options.output) {
        fs.writeFileSync(options.output, json);
        console.log(`Snapshot written to ${options.output}`);
      } else {
        console.log(json);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

program
  .command('diff <file1> <file2>')
  .description('Compare two snapshot JSON files and report added/removed/modified keys')
  .action((file1: string, file2: string) => {
    for (const file of [file1, file2]) {
      if (!fs.existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        process.exitCode = 2;
        return;
      }
    }
    try {
      const before = loadSnapshot(file1);
      const after = loadSnapshot(file2);
      const diff = diffSnapshots(before, after);
      console.log(formatDiff(diff));
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv);
}

export { captureSnapshot, makeRpcFetcher } from './snapshot';
export { diffSnapshots, formatDiff } from './diff';
export { buildStorageKey, decodeEntry, renderKeyDisplay, bigintSafe } from './decode';
export * from '../types';
