/**
 * Shared types for the Soroban contract storage snapshot/diff CLI.
 *
 * IMPORTANT: Soroban RPC has no "list every storage key for contract X"
 * method (`getLedgerEntries` requires the caller to already know which
 * `LedgerKey`s to fetch). This tool always snapshots a contract's single
 * instance storage entry (fetchable directly), plus whatever explicit
 * persistent storage keys the caller supplies via `--keys`. See README.md
 * for how to supply keys and why this isn't a limitation this tool's own
 * code can work around.
 */

export type StorageDurability = 'instance' | 'persistent' | 'temporary';

/** A single decoded storage entry, keyed by its Soroban storage key
 * rendered as a human-readable string (e.g. a Symbol's value, or a
 * bracketed tuple for a compound key) alongside the raw base64 XDR for
 * exact round-tripping. */
export interface StorageEntrySnapshot {
  durability: StorageDurability;
  /** Human-readable rendering of the decoded storage key. */
  keyDisplay: string;
  /** Base64 XDR of the raw `LedgerKey`, for exact re-fetching/diffing. */
  keyXdr: string;
  /** The decoded value, converted to a plain JS value via `scValToNative`
   * (bigint values are stringified so the snapshot is valid JSON). */
  value: unknown;
  /** Base64 XDR of the raw `LedgerEntryData`, if the entry exists. */
  valueXdr: string | null;
  /** True if the RPC reported this key as not present in the ledger
   * (distinct from a value that decodes to `null`/`void`). */
  missing: boolean;
  liveUntilLedgerSeq: number | null;
}

export interface ContractSnapshot {
  contractId: string;
  network: string;
  capturedAt: string;
  latestLedger: number;
  entries: StorageEntrySnapshot[];
}

export interface SnapshotCliOptions {
  rpcUrl: string;
  contractId: string;
  output?: string;
  keys: string[];
  durability: StorageDurability;
}

export type DiffChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffEntry {
  keyDisplay: string;
  changeType: DiffChangeType;
  before: unknown;
  after: unknown;
}

export interface SnapshotDiff {
  contractIdBefore: string;
  contractIdAfter: string;
  entries: DiffEntry[];
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  unchangedCount: number;
}
