import { Address, rpc, scValToNative, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { StorageDurability, StorageEntrySnapshot } from '../types';

/** Build the Soroban `LedgerKey` for a contract's persistent/temporary
 * storage entry keyed by `keySymbol` (a plain string, encoded as an
 * `ScSymbol`). For compound keys (e.g. a Rust enum variant carrying a
 * tuple, like `DataKey::Proposal(u64)`), pass the already-built
 * `xdr.ScVal` via `builtKey` instead of `keySymbol`. */
export function buildStorageKey(
  contractId: string,
  durability: StorageDurability,
  keySymbol?: string,
  builtKey?: xdr.ScVal
): xdr.LedgerKey {
  if (durability === 'instance') {
    return xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(contractId).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );
  }

  const key = builtKey ?? nativeToScVal(keySymbol, { type: 'symbol' });
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability:
        durability === 'temporary' ? xdr.ContractDataDurability.temporary() : xdr.ContractDataDurability.persistent(),
    })
  );
}

/** Render a decoded storage key as a short, human-readable string for
 * display in reports/diffs. */
export function renderKeyDisplay(durability: StorageDurability, key: xdr.ScVal): string {
  if (durability === 'instance') return '<instance>';
  const decoded = scValToNative(key);
  return typeof decoded === 'bigint' ? decoded.toString() : JSON.stringify(decoded);
}

/**
 * Convert any `bigint` values nested in a decoded SCVal (e.g. i128/u64
 * results from `scValToNative`) to strings, so the result is valid JSON.
 * Soroban's i128/u256 types routinely exceed `Number.MAX_SAFE_INTEGER`, so
 * silently coercing to `number` would lose precision; strings preserve the
 * exact value and round-trip through `JSON.stringify`/`JSON.parse` safely.
 */
export function bigintSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(bigintSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, bigintSafe(v)]));
  }
  return value;
}

/**
 * Decode one `getLedgerEntries` response entry (or a "not found" marker)
 * into a `StorageEntrySnapshot`. `entry` is `null` when the RPC reported
 * the key as absent from the ledger (an expired or never-written entry) —
 * distinguished from a value that itself decodes to `null`/void.
 */
export function decodeEntry(
  durability: StorageDurability,
  ledgerKey: xdr.LedgerKey,
  entry: rpc.Api.LedgerEntryResult | null
): StorageEntrySnapshot {
  const keyScVal =
    durability === 'instance' ? xdr.ScVal.scvLedgerKeyContractInstance() : ledgerKey.contractData().key();

  if (!entry) {
    return {
      durability,
      keyDisplay: renderKeyDisplay(durability, keyScVal),
      keyXdr: ledgerKey.toXDR('base64'),
      value: null,
      valueXdr: null,
      missing: true,
      liveUntilLedgerSeq: null,
    };
  }

  const contractData = entry.val.contractData();
  const decodedValue = bigintSafe(scValToNative(contractData.val()));

  return {
    durability,
    keyDisplay: renderKeyDisplay(durability, keyScVal),
    keyXdr: ledgerKey.toXDR('base64'),
    value: decodedValue,
    valueXdr: entry.val.toXDR('base64'),
    missing: false,
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq ?? null,
  };
}
