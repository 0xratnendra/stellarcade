# Keypair Hygiene Linter

A fast static analysis CLI and linter scanning codebases for raw Stellar secret seeds (`S[A-Z2-7]{55}`) and private credentials while ignoring public keys (`G...`) and test fixtures.

## Usage

```bash
# Run scanner
npx keypair-hygiene-linter --dir ./src --fail-on-secret
```

## API Usage

```typescript
import { scanDirectory, scanFileContent } from '@stellarcade/keypair-hygiene-linter';

const report = scanDirectory('./src');
if (report.hasLeaks) {
  console.error(`Detected ${report.matches.length} leaks`);
}
```
