import {
  BYTES_PER_KB,
  CostBreakdown,
  DEFAULT_FEE_RATES,
  FeeRates,
  INSTRUCTIONS_INCREMENT,
  RentInput,
  ResourceUsage,
  STROOPS_PER_XLM,
} from '../types';

/**
 * Estimate the resource fee (compute + read/write + tx-size + events) for a
 * single Soroban transaction's resource usage, following the linear
 * per-unit-rate structure documented in Soroban's `fees.rs` (see README for
 * the source reference). Storage rent is a separate, per-entry calculation
 * — see `estimateRentFee`.
 */
export function estimateResourceFee(
  usage: ResourceUsage,
  rates: FeeRates = DEFAULT_FEE_RATES
): Omit<CostBreakdown, 'rentFee' | 'refundableResourceFee' | 'nonRefundableResourceFee' | 'resourceFee' | 'baseFee' | 'totalFeeStroops' | 'totalFeeXlm'> {
  if (usage.cpuInstructions < 0) {
    throw new Error('cpuInstructions must be non-negative');
  }
  if (usage.operationCount <= 0) {
    throw new Error('operationCount must be positive');
  }

  const computeFee = Math.ceil(usage.cpuInstructions / INSTRUCTIONS_INCREMENT) * rates.feePerInstructionIncrement;

  const readFee =
    usage.readEntries * rates.feePerReadEntry + Math.ceil(usage.readBytes / BYTES_PER_KB) * rates.feePerReadKb;

  const writeFee =
    usage.writeEntries * rates.feePerWriteEntry + Math.ceil(usage.writeBytes / BYTES_PER_KB) * rates.feePerWriteKb;

  const transactionSizeFee = Math.ceil(usage.transactionSizeBytes / BYTES_PER_KB) * rates.feePerTxSizeKb;

  const eventsFee = Math.ceil(usage.eventsSizeBytes / BYTES_PER_KB) * rates.feePerEventsKb;

  return { computeFee, readFee, writeFee, transactionSizeFee, eventsFee };
}

/**
 * Estimate the storage rent fee for extending one or more ledger entries'
 * TTLs. Rent is proportional to entry size (in KB) times the number of
 * ledgers the TTL is extended by, per Soroban's `compute_rent_fee`
 * structure (see README).
 */
export function estimateRentFee(entries: RentInput[], rates: FeeRates = DEFAULT_FEE_RATES): number {
  return entries.reduce((total, entry) => {
    if (entry.entrySizeBytes < 0 || entry.extensionLedgers < 0) {
      throw new Error('entrySizeBytes and extensionLedgers must be non-negative');
    }
    const sizeKb = Math.ceil(entry.entrySizeBytes / BYTES_PER_KB);
    return total + sizeKb * entry.extensionLedgers * rates.feePerRentKb;
  }, 0);
}

/**
 * Full cost breakdown for a transaction: resource fee (compute + storage
 * I/O + tx size + events) plus storage rent plus the classic per-operation
 * base fee. This is the primary entry point CLI and library callers use.
 */
export function estimateTransactionCost(
  usage: ResourceUsage,
  rentEntries: RentInput[] = [],
  rates: FeeRates = DEFAULT_FEE_RATES
): CostBreakdown {
  const partial = estimateResourceFee(usage, rates);
  const rentFee = estimateRentFee(rentEntries, rates);

  const nonRefundableResourceFee = partial.computeFee + partial.readFee + partial.writeFee + partial.transactionSizeFee;
  const refundableResourceFee = partial.eventsFee + rentFee;
  const resourceFee = nonRefundableResourceFee + refundableResourceFee;
  const baseFee = usage.operationCount * rates.baseFeePerOperation;
  const totalFeeStroops = resourceFee + baseFee;

  return {
    ...partial,
    rentFee,
    nonRefundableResourceFee,
    refundableResourceFee,
    resourceFee,
    baseFee,
    totalFeeStroops,
    totalFeeXlm: totalFeeStroops / STROOPS_PER_XLM,
  };
}

export function formatBreakdown(breakdown: CostBreakdown): string {
  const line = (label: string, stroops: number) => `${label.padEnd(28)} ${stroops.toLocaleString()} stroops`;
  return [
    'Transaction Cost Breakdown',
    '===========================',
    line('Compute (CPU)', breakdown.computeFee),
    line('Storage reads', breakdown.readFee),
    line('Storage writes', breakdown.writeFee),
    line('Transaction size', breakdown.transactionSizeFee),
    line('Contract events', breakdown.eventsFee),
    line('Storage rent (TTL)', breakdown.rentFee),
    '---------------------------',
    line('Non-refundable', breakdown.nonRefundableResourceFee),
    line('Refundable', breakdown.refundableResourceFee),
    line('Resource fee', breakdown.resourceFee),
    line('Base fee (classic)', breakdown.baseFee),
    '===========================',
    line('Total', breakdown.totalFeeStroops),
    `${'Total (XLM)'.padEnd(28)} ${breakdown.totalFeeXlm.toFixed(7)} XLM`,
  ].join('\n');
}
