#!/usr/bin/env node

import * as fs from 'fs';
import { Command } from 'commander';
import { estimateTransactionCost, formatBreakdown } from './estimator';
import { DEFAULT_FEE_RATES, FeeRates, RentInput, ResourceUsage } from '../types';

/**
 * Parse a JSON payload into `ResourceUsage` + optional rent entries.
 *
 * Accepts two shapes:
 *  1. This tool's own explicit shape: `{ usage: ResourceUsage, rent?: RentInput[] }`.
 *  2. A raw `simulateTransaction` RPC response that has already been
 *     decoded into numeric fields under `resources` (matching
 *     `SorobanTransactionData.resources`), for a caller piping the output
 *     of `stellar-sdk`'s own XDR decoding into this tool rather than this
 *     tool decoding XDR itself. This tool intentionally does not depend on
 *     `@stellar/stellar-sdk` (none of this workspace's other
 *     `experimental/tools/*` do either) — decoding raw base64
 *     `SorobanTransactionData` XDR is left to the caller.
 */
function parsePayload(raw: unknown): { usage: ResourceUsage; rent: RentInput[] } {
  const obj = raw as Record<string, unknown>;

  if (obj.usage && typeof obj.usage === 'object') {
    return {
      usage: obj.usage as ResourceUsage,
      rent: Array.isArray(obj.rent) ? (obj.rent as RentInput[]) : [],
    };
  }

  const resources = obj.resources as Record<string, unknown> | undefined;
  if (resources) {
    const footprint = (resources.footprint as Record<string, unknown>) ?? {};
    const usage: ResourceUsage = {
      cpuInstructions: Number(resources.instructions ?? 0),
      readBytes: Number(resources.readBytes ?? footprint.readBytes ?? 0),
      writeBytes: Number(resources.writeBytes ?? footprint.writeBytes ?? 0),
      readEntries: Number(resources.readEntries ?? footprint.readEntries ?? 0),
      writeEntries: Number(resources.writeEntries ?? footprint.writeEntries ?? 0),
      transactionSizeBytes: Number(resources.transactionSizeBytes ?? 0),
      eventsSizeBytes: Number(resources.eventsSizeBytes ?? 0),
      operationCount: Number(obj.operationCount ?? 1),
    };
    return { usage, rent: Array.isArray(obj.rent) ? (obj.rent as RentInput[]) : [] };
  }

  throw new Error(
    'Unrecognized payload shape. Expected { usage, rent? } or { resources: {...}, rent? }. See README.md for examples.'
  );
}

function loadRates(ratesPath: string | undefined): FeeRates {
  if (!ratesPath) return DEFAULT_FEE_RATES;
  const raw = JSON.parse(fs.readFileSync(ratesPath, 'utf-8'));
  return { ...DEFAULT_FEE_RATES, ...raw };
}

const program = new Command();

program
  .name('transaction-cost-estimator')
  .description(
    'Estimate Soroban resource fees and storage footprint costs from a simulation payload (formula-based, see README).'
  )
  .version('0.0.1')
  .requiredOption('--input <path>', 'Path to a JSON payload (see README for the accepted shapes)')
  .option('--rates <path>', 'Path to a JSON file overriding one or more default fee rates')
  .option('--json', 'Output the raw JSON breakdown instead of a formatted table', false)
  .action((options) => {
    if (!fs.existsSync(options.input)) {
      console.error(`Error: File not found: ${options.input}`);
      process.exitCode = 2;
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(options.input, 'utf-8'));
      const { usage, rent } = parsePayload(raw);
      const rates = loadRates(options.rates);
      const breakdown = estimateTransactionCost(usage, rent, rates);

      if (options.json) {
        console.log(JSON.stringify(breakdown, null, 2));
      } else {
        console.log(formatBreakdown(breakdown));
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv);
}

export { estimateTransactionCost, estimateResourceFee, estimateRentFee, formatBreakdown } from './estimator';
export * from '../types';
