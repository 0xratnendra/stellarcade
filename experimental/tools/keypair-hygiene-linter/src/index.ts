import fs from 'fs';
import path from 'path';

export interface SecretMatch {
  file: string;
  lineNumber: number;
  lineContent: string;
  matchedSecret: string;
  secretType: 'stellar-secret-seed' | 'private-key';
}

export interface LintReport {
  scannedFilesCount: number;
  matches: SecretMatch[];
  hasLeaks: boolean;
}

// Stellar secret seed format: S followed by 55 base32 characters (A-Z, 2-7)
const STELLAR_SECRET_SEED_REGEX = /\b(S[A-Z2-7]{55})\b/g;

// Public key format: G followed by 55 base32 characters (A-Z, 2-7) - should NOT trigger warnings
const STELLAR_PUBLIC_KEY_REGEX = /\b(G[A-Z2-7]{55})\b/g;

export function isFixtureOrTestPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/');
  return (
    norm.includes('/__fixtures__/') ||
    norm.includes('/test/') ||
    norm.includes('/tests/') ||
    norm.includes('.test.') ||
    norm.includes('.spec.') ||
    norm.includes('/node_modules/') ||
    norm.includes('/dist/')
  );
}

export function scanFileContent(content: string, filePath = 'unknown'): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Explicit fixture comment check
    if (line.includes('// @fixture') || line.includes('/* @fixture */') || line.includes('# @fixture')) {
      continue;
    }

    STELLAR_SECRET_SEED_REGEX.lastIndex = 0;
    let match;
    while ((match = STELLAR_SECRET_SEED_REGEX.exec(line)) !== null) {
      const secret = match[1];

      // Exclude repeated character strings like SAAAAAA... which are placeholder strings
      const uniqueChars = new Set(secret).size;
      if (uniqueChars <= 5) continue;

      matches.push({
        file: filePath,
        lineNumber: i + 1,
        lineContent: line.trim(),
        matchedSecret: `${secret.slice(0, 4)}...${secret.slice(-4)}`,
        secretType: 'stellar-secret-seed',
      });
    }
  }

  return matches;
}

export function scanDirectory(dirPath: string): LintReport {
  const matches: SecretMatch[] = [];
  let scannedFilesCount = 0;

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (isFixtureOrTestPath(fullPath)) continue;
        scannedFilesCount++;
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const fileMatches = scanFileContent(content, fullPath);
          matches.push(...fileMatches);
        } catch {
          // Ignore binary or unreadable files
        }
      }
    }
  }

  walk(dirPath);

  return {
    scannedFilesCount,
    matches,
    hasLeaks: matches.length > 0,
  };
}

// Minimal CLI runner
if (require.main === module) {
  const args = process.argv.slice(2);
  let targetDir = '.';
  let failOnSecret = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir') targetDir = args[++i];
    else if (args[i] === '--fail-on-secret') failOnSecret = true;
  }

  try {
    const report = scanDirectory(targetDir);
    console.log(`Scanned files: ${report.scannedFilesCount}`);
    console.log(`Detected secret leaks: ${report.matches.length}`);

    if (report.matches.length > 0) {
      console.log('\n[CRITICAL: Hardcoded Secrets Detected]');
      report.matches.forEach((m) => {
        console.log(`  - ${m.file}:${m.lineNumber} [${m.secretType}] ${m.matchedSecret}`);
      });

      if (failOnSecret) {
        console.error('\nLinter failed: hardcoded secret seed detected.');
        process.exit(1);
      }
    } else {
      console.log('No hardcoded secrets detected.');
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
