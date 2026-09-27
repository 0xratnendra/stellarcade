# contract-state-snapshot

A standalone CLI and library for dumping a Soroban contract's storage
state to a JSON fixture, and diffing two such snapshots.

> **Status:** experimental, self-contained tool under `experimental/tools/`.
> It does not modify or depend on any core repo tooling.

## What it snapshots, and why you must supply keys

Soroban RPC has no "list every storage key for this contract" method.
`getLedgerEntries` (the underlying RPC call) requires the caller to already
know which `LedgerKey`s to fetch; there is no enumeration endpoint. This
is a real limitation of the Soroban RPC protocol, not something this
tool's own code can work around.

Given that, this tool always fetches a contract's **instance** storage
entry (which is directly addressable without knowing its internal keys),
plus whatever **persistent** or **temporary** Symbol-keyed storage keys you
explicitly pass via `--keys`. In practice, you get those key names from
the contract's own source (its `DataKey` enum's Symbol variants) or from a
previous snapshot/observation.

Compound keys (a Rust enum variant carrying a tuple, e.g.
`DataKey::Proposal(u64)`) aren't expressible as a single `--keys` Symbol
string in the CLI; use the library's `buildStorageKey(contractId,
durability, undefined, builtScVal)` overload with a manually constructed
`xdr.ScVal` for those.

## Decoding

Storage values are decoded via `@stellar/stellar-sdk`'s `scValToNative`,
which handles every SCVal variant (bool, void, integers up to i256/u256,
bytes, string, symbol, vec, map, address, and the contract-instance
marker). `bigint` results (from i64/i128/u64/u128/i256/u256 values, which
routinely exceed `Number.MAX_SAFE_INTEGER`) are stringified before being
written to JSON, so no precision is lost and the file remains valid JSON.

## Installation

```bash
cd experimental/tools/contract-state-snapshot
npm install
npm run build
```

## Usage

### Snapshot

```bash
contract-state-snapshot --rpc <url> --contract-id <id> [--output <file.json>] [--keys <symbols>] [--durability persistent|temporary]
```

- `--rpc`: Soroban RPC endpoint URL.
- `--contract-id`: the contract's `C...` strkey. Rejected immediately
  (before any network call) if it isn't a validly-formatted contract ID.
- `--output`: write the snapshot JSON to a file instead of stdout.
- `--keys`: comma-separated list of persistent/temporary storage key
  Symbols to fetch, in addition to the always-included instance entry.
- `--durability`: whether `--keys` refers to `persistent` (default) or
  `temporary` storage.

### Diff

```bash
contract-state-snapshot diff <file1.json> <file2.json>
```

Reports keys as `added`, `removed`, or `modified` between the two
snapshots (matched by durability + decoded key), printing only changed
entries. Values are compared via a key-order-independent JSON comparison,
so a decoded Map whose fields happen to serialize in a different order
does not register as a false-positive change. A key that exists in both
snapshots but flips between present and "missing" (deleted on-chain, or
its TTL expired) is reported as `modified`.

## Library usage

```ts
import { captureSnapshot, makeRpcFetcher, diffSnapshots } from '@stellarcade/contract-state-snapshot';
import { rpc } from '@stellar/stellar-sdk';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const snapshot = await captureSnapshot(
  contractId,
  'testnet',
  ['BALANCE', 'ADMIN'],
  'persistent',
  makeRpcFetcher(server)
);
```

`captureSnapshot`'s last argument is an injectable `LedgerEntryFetcher`,
which is how the test suite substitutes a fake response instead of making
real RPC calls: decoding is tested against real `@stellar/stellar-sdk`
XDR-encoded fixtures (built with the SDK's own `nativeToScVal`/
`ContractDataEntry` constructors), but no test connects to a live network.

## Testing

```bash
npm test
```

Covers SCVal decoding (Symbol, Address, i128, Vec, Map, void, and the
present-vs-missing distinction) against real XDR fixtures, snapshot
capture logic, diff detection (added/removed/modified/unchanged), and
invalid contract ID handling.
