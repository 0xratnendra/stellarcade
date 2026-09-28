import { verifySchemaConsistency, printSchemaReport } from './schemaChecker';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    const value = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : undefined;
    if (value) {
      args.set(arg, value);
      index += 1;
    }
  }
}

const schemaPath = args.get('--schema') ?? './schema.prisma';
const migrationsDir = args.get('--migrations') ?? './prisma/migrations';
const strict = args.has('--strict');

const result = verifySchemaConsistency(schemaPath, migrationsDir, strict);
console.log(printSchemaReport(schemaPath, migrationsDir, strict));
process.exit(result.valid ? 0 : 1);
