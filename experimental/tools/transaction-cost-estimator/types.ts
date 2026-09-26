/**
 * Shared types for the Soroban transaction cost estimator.
 *
 * IMPORTANT: the per-unit fee rates below are FORMULA DEFAULTS, not live
 * network values. Soroban's real resource fee rates are governance-adjustable
 * `ConfigSettingEntry` ledger entries (ConfigSettingContractComputeV0,
 * ConfigSettingContractLedgerCostV0, etc.) that validators can vote to
 * change — they are not fixed protocol constants. See README.md for how to
 * override these defaults with current rates, and for citations.
 */

/** Per-unit resource fee rates, in stroops. Overridable; see README. */
export interface FeeRates {
  /** Stroops per INSTRUCTIONS_INCREMENT (10,000) CPU instructions. */
  feePerInstructionIncrement: number;
  /** Stroops per ledger-entry read (disk read). */
  feePerReadEntry: number;
  /** Stroops per ledger-entry write. */
  feePerWriteEntry: number;
  /** Stroops per 1KB of ledger data read. */
  feePerReadKb: number;
  /** Stroops per 1KB of ledger data written. */
  feePerWriteKb: number;
  /** Stroops per 1KB of transaction envelope size. */
  feePerTxSizeKb: number;
  /** Stroops per 1KB of emitted contract event data. */
  feePerEventsKb: number;
  /** Stroops per 1KB of rent (storage TTL extension), per rent-eligible ledger. */
  feePerRentKb: number;
  /** Classic per-operation base (inclusion) fee, in stroops. */
  baseFeePerOperation: number;
}

/** Default fee rates. See the module doc above: these are illustrative
 * formula defaults, not verified current mainnet values. */
export const DEFAULT_FEE_RATES: FeeRates = {
  feePerInstructionIncrement: 7,
  feePerReadEntry: 6_250,
  feePerWriteEntry: 10_000,
  feePerReadKb: 1_670,
  feePerWriteKb: 4_000,
  feePerTxSizeKb: 1_000,
  feePerEventsKb: 10_000,
  feePerRentKb: 1_000,
  baseFeePerOperation: 100,
};

export const INSTRUCTIONS_INCREMENT = 10_000;
export const BYTES_PER_KB = 1_024;
export const STROOPS_PER_XLM = 10_000_000;

/** The resource inputs a caller supplies (mirrors the shape of a decoded
 * `SorobanTransactionData.resources` from a real `simulateTransaction`
 * response, so a real simulation result's fields map directly onto this
 * without renaming). */
export interface ResourceUsage {
  cpuInstructions: number;
  /** Total bytes read across the ledger footprint (readOnly + readWrite). */
  readBytes: number;
  /** Total bytes written across the readWrite footprint. */
  writeBytes: number;
  /** Number of distinct ledger entries read. */
  readEntries: number;
  /** Number of distinct ledger entries written. */
  writeEntries: number;
  /** Serialized transaction envelope size, in bytes. */
  transactionSizeBytes: number;
  /** Total size of emitted contract/diagnostic events, in bytes. */
  eventsSizeBytes: number;
  /** Number of operations in the transaction (for the classic base fee). */
  operationCount: number;
}

/** Storage rent inputs: one entry per ledger entry being extended. */
export interface RentInput {
  /** Size of the entry's data, in bytes. */
  entrySizeBytes: number;
  /** Number of ledgers the entry's TTL is being extended by. */
  extensionLedgers: number;
}

export interface CostBreakdown {
  computeFee: number;
  readFee: number;
  writeFee: number;
  transactionSizeFee: number;
  eventsFee: number;
  rentFee: number;
  /** computeFee + readFee + writeFee + transactionSizeFee (non-refundable
   * portion of the resource fee, matching Soroban's own split). */
  nonRefundableResourceFee: number;
  /** eventsFee + rentFee (refundable portion: only charged for what's
   * actually consumed). */
  refundableResourceFee: number;
  resourceFee: number;
  baseFee: number;
  totalFeeStroops: number;
  totalFeeXlm: number;
}

export interface CliOptions {
  rates: FeeRates;
  json: boolean;
}
