import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HealthPoller } from './healthPoller';
import { HealthEndpointConfig, HealthSnapshot } from './types';

const args = parseArgs(process.argv.slice(2));
const configPath = args['config'] ?? args['c'];
const intervalMs = parseInterval(args['interval'] ?? '5s');

if (!configPath) {
  console.error('Usage: node cli.ts --config <endpoints.json> [--interval 5s]');
  process.exit(1);
}

const rawConfig = readFileSync(resolve(process.cwd(), configPath), 'utf8');
const endpoints: HealthEndpointConfig[] = JSON.parse(rawConfig);

const poller = new HealthPoller(endpoints, { intervalMs });

const renderDashboard = (snapshot: HealthSnapshot) => {
  const lines: string[] = [];
  lines.push('\x1b[2J\x1b[H');
  lines.push('StellarCade Health Dashboard');
  lines.push(`Updated: ${new Date(snapshot.generatedAt).toLocaleTimeString()}`);
  lines.push('');

  snapshot.results.forEach((result) => {
    const statusLabel =
      result.status === 'operational'
        ? '🟢 Operational'
        : result.status === 'degraded'
          ? '🟡 Degraded'
          : '🔴 Down';

    const sparkline = createSparkline(result.sparkline);
    const ledgerText = result.ledgerSequence == null ? '--' : String(result.ledgerSequence);
    const syncText = result.syncLag == null ? '--' : `${result.syncLag} lag`;

    lines.push(
      `${result.name.padEnd(24)} ${statusLabel.padEnd(18)} ${String(result.latencyMs).padStart(4)}ms ${sparkline.padEnd(12)} ${ledgerText.padStart(8)} ${syncText.padStart(12)}`
    );
  });

  lines.push('');
  lines.push('Keys: r refresh   q quit');
  console.log(lines.join('\n'));
};

const handleKeypress = (key?: string) => {
  if (!key) return;

  if (key === 'r' || key === 'R') {
    void poller.pollOnce().then(renderDashboard);
    return;
  }

  if (key === 'q' || key === 'Q') {
    cleanup();
    process.exit(0);
  }
};

const cleanup = () => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
  }
  process.stdin.removeListener('data', onStdinData);
  process.stdin.pause();
};

const onStdinData = (chunk: Buffer | string) => {
  const key = typeof chunk === 'string' ? chunk.trim().toLowerCase() : chunk.toString().trim().toLowerCase();
  handleKeypress(key);
};

if (process.stdin.isTTY) {
  process.stdin.setRawMode?.(true);
}
process.stdin.resume();
process.stdin.on('data', onStdinData);

poller.start(renderDashboard);

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith('--')) {
      result[argv[i].slice(2)] = argv[i + 1] ?? '';
    }
  }
  return result;
}

function parseInterval(value: string): number {
  if (!value) return 5000;
  if (value.endsWith('ms')) return Number(value.slice(0, -2));
  if (value.endsWith('s')) return Number(value.slice(0, -1)) * 1000;
  return 5000;
}

function createSparkline(points: number[]): string {
  if (!points.length) return '▁▁▁▁▁';
  const max = Math.max(...points);
  const min = Math.min(...points);

  if (max === min) return '▁▁▁▁▁';

  return points
    .map((point) => {
      const ratio = (point - min) / (max - min || 1);
      if (ratio < 0.2) return '▁';
      if (ratio < 0.4) return '▂';
      if (ratio < 0.6) return '▃';
      if (ratio < 0.8) return '▄';
      return '▅';
    })
    .join('');
}
