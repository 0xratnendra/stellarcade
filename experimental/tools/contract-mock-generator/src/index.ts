#!/usr/bin/env node

import * as fs from 'fs';
import { Command } from 'commander';
import { parseContractSource } from './parser';
import { generateMockFile } from './generator';

const program = new Command();

program
  .name('contract-mock-generator')
  .description('Generate mock TypeScript Soroban contract clients (vi.fn()-based) from a contract lib.rs.')
  .version('0.0.1')
  .requiredOption('--source <path>', 'Path to the contract Rust source file (lib.rs)')
  .option('--output <path>', 'Write the generated mock TypeScript to this file instead of stdout')
  .option('--no-latency', 'Omit the simulated network latency helper from the generated mock')
  .option('--no-errors', 'Omit the error-mock documentation comment from the generated mock')
  .action((options) => {
    if (!fs.existsSync(options.source)) {
      console.error(`Error: File not found: ${options.source}`);
      process.exitCode = 2;
      return;
    }

    try {
      const source = fs.readFileSync(options.source, 'utf-8');
      const contracts = parseContractSource(source);
      const generated = generateMockFile(contracts, {
        includeLatencySimulation: options.latency !== false,
        includeErrorMocks: options.errors !== false,
      });

      if (options.output) {
        fs.writeFileSync(options.output, generated);
        console.log(`Generated ${contracts.length} mock client(s) -> ${options.output}`);
      } else {
        console.log(generated);
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

if (require.main === module) {
  program.parseAsync(process.argv);
}

export { parseContractSource } from './parser';
export { generateMockClient, generateMockFile } from './generator';
export { mapRustType } from './type-mapper';
export * from '../types';
