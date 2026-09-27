# WASM Strip Optimizer

A Node.js utility and CLI tool for stripping debug symbols, `name`, `producers`, and target-specific custom sections from compiled Soroban WASM binaries while preserving essential contract specification sections (`contractenvmetav0`, `contractspecv0`).

## Installation & Usage

```bash
# Run CLI
npx wasm-strip-optimizer --input <path-to-raw.wasm> --output <path-to-opt.wasm>
```

## API Usage

```typescript
import { stripWasmFile, stripWasmBuffer } from '@stellarcade/wasm-strip-optimizer';

const result = stripWasmFile({
  input: './target/wasm32-unknown-unknown/release/contract.wasm',
  output: './target/wasm32-unknown-unknown/release/contract.stripped.wasm',
  keepSpec: true,
});

console.log(`Saved ${result.bytesSaved} bytes (${result.percentSaved}%)`);
```
