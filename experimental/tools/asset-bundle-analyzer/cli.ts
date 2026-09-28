import { auditAssetDirectory, formatBytes } from './assetAuditor';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    const key = arg;
    const value = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : undefined;
    if (value) {
      args.set(key, value);
      index += 1;
    }
  }
}

const dir = args.get('--dir') ?? process.cwd();
const maxImageKb = Number(args.get('--max-image-kb') ?? 500);
const maxAudioKb = Number(args.get('--max-audio-kb') ?? 1000);

const summary = auditAssetDirectory({ dir, maxImageKb, maxAudioKb });
console.log(summary.table);
console.log(`\n${summary.flags.length > 0 ? 'Audit warnings detected.' : 'No audit warnings detected.'}`);
console.log(`Total payload: ${formatBytes(summary.totalBytes)}`);
