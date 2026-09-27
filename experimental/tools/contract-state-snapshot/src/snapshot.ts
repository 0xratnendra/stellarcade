import { rpc, StrKey, xdr } from '@stellar/stellar-sdk';
import { buildStorageKey, decodeEntry } from './decode';
import { ContractSnapshot, StorageDurability, StorageEntrySnapshot } from '../types';

/** Injectable ledger-entry fetcher, so tests can substitute a fake RPC
 * response instead of connecting to a real Soroban RPC endpoint. The real
 * CLI wires this to a `rpc.Server` instance's `getLedgerEntries`. */
export type LedgerEntryFetcher = (
  keys: xdr.LedgerKey[]
) => Promise<{ entries: rpc.Api.LedgerEntryResult[]; latestLedger: number }>;

export function makeRpcFetcher(server: rpc.Server): LedgerEntryFetcher {
  return async (keys) => {
    const response = await server.getLedgerEntries(...keys);
    return { entries: response.entries, latestLedger: response.latestLedger };
  };
}

/**
 * Fetch and decode a contract's instance storage entry plus every
 * explicitly requested persistent/temporary key. See types.ts's module doc
 * for why the set of persistent keys must be supplied by the caller:
 * Soroban RPC has no "list every key for this contract" method.
 */
export async function captureSnapshot(
  contractId: string,
  network: string,
  keys: string[],
  durability: StorageDurability,
  fetchEntries: LedgerEntryFetcher
): Promise<ContractSnapshot> {
  if (!StrKey.isValidContract(contractId)) {
    throw new Error(`Invalid contract ID: ${contractId}`);
  }

  const instanceKey = buildStorageKey(contractId, 'instance');
  const persistentKeys = durability === 'instance' ? [] : keys.map((k) => buildStorageKey(contractId, durability, k));
  const allKeys = [instanceKey, ...persistentKeys];

  const { entries, latestLedger } = await fetchEntries(allKeys);

  // getLedgerEntries omits keys that don't exist rather than returning a
  // null placeholder for them, so absent keys must be detected by their
  // absence from the response, matched back to the request by re-encoding
  // each fetched entry's own key and comparing XDR.
  const foundByKeyXdr = new Map<string, rpc.Api.LedgerEntryResult>();
  for (const entry of entries) {
    foundByKeyXdr.set(entry.key.toXDR('base64'), entry);
  }

  const snapshotEntries: StorageEntrySnapshot[] = [];
  snapshotEntries.push(decodeEntry('instance', instanceKey, foundByKeyXdr.get(instanceKey.toXDR('base64')) ?? null));
  for (const key of persistentKeys) {
    snapshotEntries.push(decodeEntry(durability, key, foundByKeyXdr.get(key.toXDR('base64')) ?? null));
  }

  return {
    contractId,
    network,
    capturedAt: new Date().toISOString(),
    latestLedger,
    entries: snapshotEntries,
  };
}
