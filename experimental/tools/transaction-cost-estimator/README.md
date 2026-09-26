# transaction-cost-estimator

A standalone CLI and library for estimating Soroban transaction resource
fees (compute, storage read/write, transaction size, contract events) and
storage rent (TTL extension cost), given a resource usage profile.

> **Status:** experimental, self-contained tool under `experimental/tools/`.
> It does not modify or depend on any core repo tooling.

## Formula, not live network rates: read this first

This tool does not call a live Soroban RPC endpoint. It implements the
linear per-unit-rate fee formula documented in Soroban's own fee
accounting (`soroban-env-host`'s `fees.rs`, the project's own canonical
reference: https://github.com/stellar/rs-soroban-env/blob/main/soroban-env-host/src/fees.rs),
structured as:

```
resourceFee =
    ceil(cpuInstructions / 10_000) * feePerInstructionIncrement
  + readEntries  * feePerReadEntry  + ceil(readBytes  / 1024) * feePerReadKb
  + writeEntries * feePerWriteEntry + ceil(writeBytes / 1024) * feePerWriteKb
  + ceil(transactionSizeBytes / 1024) * feePerTxSizeKb
  + ceil(eventsSizeBytes / 1024) * feePerEventsKb

rentFee = sum over each ledger entry of:
    ceil(entrySizeBytes / 1024) * extensionLedgers * feePerRentKb

totalFee = resourceFee + rentFee + (operationCount * baseFeePerOperation)
```

**The default per-unit rates in `types.ts` (`DEFAULT_FEE_RATES`) are
illustrative, not verified current mainnet values.** Soroban's real
per-unit rates are governance-adjustable `ConfigSettingEntry` ledger
entries (`ConfigSettingContractComputeV0`, `ConfigSettingContractLedgerCostV0`,
and related settings), not fixed protocol constants; they have changed on
mainnet before (e.g. the CPU instruction rate has been adjusted by
validator vote). To estimate real current costs, either:

- Override `--rates` with a JSON file of current values (fetch them via
  `getLedgerEntries` on the `CONFIG_SETTING` ledger keys, or from
  https://lab.stellar.org/network-limits), or
- Treat this tool's default-rate output as a *relative* comparison (e.g.
  "does invocation A cost roughly 3x invocation B"), not an absolute
  stroop quote.

The classic per-operation base fee default (100 stroops) matches the
long-standing Stellar network minimum, which is comparatively stable, but
can still rise under network-wide surge pricing.

## Why this doesn't decode raw simulation XDR

A real `simulateTransaction` RPC response encodes its resource footprint as
base64 `SorobanTransactionData` XDR. Decoding that requires
`@stellar/stellar-sdk`, which none of this workspace's other
`experimental/tools/*` packages depend on. This tool instead accepts an
already-decoded numeric payload (see "Input shapes" below); pipe the
output of `@stellar/stellar-sdk`'s own XDR parsing into this tool's input
JSON rather than duplicating that decoding here.

## Installation

```bash
cd experimental/tools/transaction-cost-estimator
npm install
npm run build
```

## Usage

```bash
transaction-cost-estimator --input payload.json [--rates rates.json] [--json]
```

### Input shapes

Either of:

```jsonc
// 1. This tool's own explicit shape.
{
  "usage": {
    "cpuInstructions": 2500000,
    "readBytes": 4096,
    "writeBytes": 2048,
    "readEntries": 3,
    "writeEntries": 2,
    "transactionSizeBytes": 512,
    "eventsSizeBytes": 256,
    "operationCount": 1
  },
  "rent": [{ "entrySizeBytes": 1024, "extensionLedgers": 100 }]
}
```

```jsonc
// 2. A decoded simulateTransaction resources object.
{
  "resources": {
    "instructions": 2500000,
    "readBytes": 4096,
    "writeBytes": 2048,
    "readEntries": 3,
    "writeEntries": 2,
    "transactionSizeBytes": 512,
    "eventsSizeBytes": 256
  },
  "operationCount": 1,
  "rent": [{ "entrySizeBytes": 1024, "extensionLedgers": 100 }]
}
```

`--rates` accepts a JSON file with any subset of `FeeRates`' fields; unset
fields fall back to `DEFAULT_FEE_RATES`.

## Library usage

```ts
import { estimateTransactionCost, formatBreakdown } from '@stellarcade/transaction-cost-estimator';

const breakdown = estimateTransactionCost(usage, rentEntries);
console.log(formatBreakdown(breakdown));
```

## Testing

```bash
npm test
```
