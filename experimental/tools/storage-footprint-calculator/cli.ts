import { calculateStorageRent, compareStorageTypes, renderComparisonTable } from './calculator';

const parseArgs = (argv: string[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        values[arg] = next;
        index += 1;
      }
    }
  }
  return values;
};

const args = parseArgs(process.argv.slice(2));
const bytesArg = args['--bytes'];
const typeArg = args['--type'] ?? 'persistent';
const ledgersArg = args['--ledgers'] ?? '1';

if (!bytesArg) {
  console.log('Usage: storage-footprint-calculator --bytes <num> --type <instance|persistent|temporary> --ledgers <num>');
  process.exit(1);
}

const bytes = Number(bytesArg);
const ledgers = Number(ledgersArg);
const type = typeArg as 'instance' | 'persistent' | 'temporary';

if (!Number.isFinite(bytes) || bytes < 0) {
  throw new Error('Invalid byte count.');
}
if (!Number.isFinite(ledgers) || ledgers < 0) {
  throw new Error('Invalid ledger count.');
}

const estimate = calculateStorageRent({ bytes, type, ledgers });
console.log(`Estimated rent for ${type} storage: ${estimate.totalRent}`);
console.log(renderComparisonTable(compareStorageTypes(bytes, ledgers)));
