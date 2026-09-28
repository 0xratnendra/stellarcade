# Storage Footprint Calculator

A fast CLI for estimating Soroban storage rent and TTL extension costs.

## Usage

```bash
cd experimental/tools/storage-footprint-calculator
npm install
npm run build
node dist/cli.js --bytes 4096 --type persistent --ledgers 12
```

This prints the per-ledger and total rent, along with a storage comparison table for instance, persistent, and temporary entries.
