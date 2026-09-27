# OpenAPI Schema Sync

A Node.js CLI tool and linter for scanning Express backend routes and bi-directionally cross-referencing them against OpenAPI 3.1 specifications.

## Usage

```bash
# Run CLI
npx openapi-schema-sync --routes-dir ./src/routes --spec ./docs/openapi.yaml --fail-on-missing
```

## API Usage

```typescript
import { scanAndCheckSync } from '@stellarcade/openapi-schema-sync';

const report = scanAndCheckSync('./src/routes', './docs/openapi.yaml');
console.log(`Matched: ${report.matchedCount}, Undocumented: ${report.undocumentedRoutes.length}`);
```
