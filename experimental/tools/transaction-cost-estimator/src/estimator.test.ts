import { describe, it, expect } from 'vitest';
import { estimateResourceFee, estimateRentFee, estimateTransactionCost, formatBreakdown } from './estimator';
import { DEFAULT_FEE_RATES, ResourceUsage, STROOPS_PER_XLM } from '../types';

function coinflipDuelUsage(): ResourceUsage {
  // Representative resource profile for a mid-complexity contract call
  // (e.g. a "coinflip duel" invocation touching a handful of storage
  // entries), per the issue's required test.
  return {
    cpuInstructions: 2_500_000,
    readBytes: 4_096,
    writeBytes: 2_048,
    readEntries: 3,
    writeEntries: 2,
    transactionSizeBytes: 512,
    eventsSizeBytes: 256,
    operationCount: 1,
  };
}

// ---------------------------------------------------------------------------
// 1. resource fee calculation for a standard coinflip duel call
// ---------------------------------------------------------------------------

describe('estimateResourceFee', () => {
  it('calculates the resource fee for a standard coinflip duel call', () => {
    const usage = coinflipDuelUsage();
    const partial = estimateResourceFee(usage);

    // computeFee = ceil(2_500_000 / 10_000) * 7 = 250 * 7 = 1_750
    expect(partial.computeFee).toBe(1_750);
    // readFee = 3 * 6_250 + ceil(4_096 / 1_024) * 1_670 = 18_750 + 4 * 1_670 = 25_430
    expect(partial.readFee).toBe(25_430);
    // writeFee = 2 * 10_000 + ceil(2_048 / 1_024) * 4_000 = 20_000 + 8_000 = 28_000
    expect(partial.writeFee).toBe(28_000);
    // transactionSizeFee = ceil(512 / 1_024) * 1_000 = 1 * 1_000 = 1_000
    expect(partial.transactionSizeFee).toBe(1_000);
    // eventsFee = ceil(256 / 1_024) * 10_000 = 1 * 10_000 = 10_000
    expect(partial.eventsFee).toBe(10_000);
  });

  it('scales compute fee linearly with instruction count, rounding up to the nearest increment', () => {
    const base = coinflipDuelUsage();
    const double = { ...base, cpuInstructions: base.cpuInstructions * 2 };

    const feeBase = estimateResourceFee(base).computeFee;
    const feeDouble = estimateResourceFee(double).computeFee;
    expect(feeDouble).toBe(feeBase * 2);
  });

  it('rounds partial instruction increments up, not down', () => {
    // 10_001 instructions must round up to 2 increments, not 1.
    const usage: ResourceUsage = { ...coinflipDuelUsage(), cpuInstructions: 10_001 };
    const partial = estimateResourceFee(usage);
    expect(partial.computeFee).toBe(2 * DEFAULT_FEE_RATES.feePerInstructionIncrement);
  });

  it('rejects negative cpuInstructions', () => {
    const usage: ResourceUsage = { ...coinflipDuelUsage(), cpuInstructions: -1 };
    expect(() => estimateResourceFee(usage)).toThrow(/non-negative/);
  });

  it('rejects a non-positive operationCount', () => {
    const usage: ResourceUsage = { ...coinflipDuelUsage(), operationCount: 0 };
    expect(() => estimateResourceFee(usage)).toThrow(/operationCount/);
  });
});

// ---------------------------------------------------------------------------
// 2. storage rent computation for varying ledger TTLs
// ---------------------------------------------------------------------------

describe('estimateRentFee', () => {
  it('computes rent proportional to entry size and TTL extension length', () => {
    const oneKbFor100Ledgers = estimateRentFee([{ entrySizeBytes: 1_024, extensionLedgers: 100 }]);
    const oneKbFor200Ledgers = estimateRentFee([{ entrySizeBytes: 1_024, extensionLedgers: 200 }]);
    expect(oneKbFor200Ledgers).toBe(oneKbFor100Ledgers * 2);

    const twoKbFor100Ledgers = estimateRentFee([{ entrySizeBytes: 2_048, extensionLedgers: 100 }]);
    expect(twoKbFor100Ledgers).toBe(oneKbFor100Ledgers * 2);
  });

  it('rounds a fractional KB size up to the next whole KB', () => {
    // 1 byte over 1KB must be billed as 2KB, not 1.
    const rounded = estimateRentFee([{ entrySizeBytes: 1_025, extensionLedgers: 1 }]);
    const twoKb = estimateRentFee([{ entrySizeBytes: 2_048, extensionLedgers: 1 }]);
    expect(rounded).toBe(twoKb);
  });

  it('sums rent across multiple entries with different sizes and TTLs', () => {
    const total = estimateRentFee([
      { entrySizeBytes: 1_024, extensionLedgers: 100 },
      { entrySizeBytes: 512, extensionLedgers: 50 },
    ]);
    const first = estimateRentFee([{ entrySizeBytes: 1_024, extensionLedgers: 100 }]);
    const second = estimateRentFee([{ entrySizeBytes: 512, extensionLedgers: 50 }]);
    expect(total).toBe(first + second);
  });

  it('returns zero rent for an empty entry list', () => {
    expect(estimateRentFee([])).toBe(0);
  });

  it('rejects negative entrySizeBytes or extensionLedgers', () => {
    expect(() => estimateRentFee([{ entrySizeBytes: -1, extensionLedgers: 1 }])).toThrow(/non-negative/);
    expect(() => estimateRentFee([{ entrySizeBytes: 1, extensionLedgers: -1 }])).toThrow(/non-negative/);
  });
});

// ---------------------------------------------------------------------------
// 3. stroop to XLM conversion accuracy
// ---------------------------------------------------------------------------

describe('stroop to XLM conversion', () => {
  it('converts total fee stroops to XLM at exactly 10,000,000 stroops per XLM', () => {
    const usage: ResourceUsage = {
      cpuInstructions: 0,
      readBytes: 0,
      writeBytes: 0,
      readEntries: 0,
      writeEntries: 0,
      transactionSizeBytes: 0,
      eventsSizeBytes: 0,
      operationCount: 1,
    };
    const breakdown = estimateTransactionCost(usage, [], {
      ...DEFAULT_FEE_RATES,
      baseFeePerOperation: STROOPS_PER_XLM, // exactly 1 XLM of base fee
    });
    expect(breakdown.totalFeeStroops).toBe(STROOPS_PER_XLM);
    expect(breakdown.totalFeeXlm).toBe(1);
  });

  it('converts a fractional stroop amount to the correct XLM fraction', () => {
    const usage: ResourceUsage = {
      cpuInstructions: 0,
      readBytes: 0,
      writeBytes: 0,
      readEntries: 0,
      writeEntries: 0,
      transactionSizeBytes: 0,
      eventsSizeBytes: 0,
      operationCount: 1,
    };
    const breakdown = estimateTransactionCost(usage, [], {
      ...DEFAULT_FEE_RATES,
      baseFeePerOperation: 100, // 100 stroops = 0.00001 XLM, the classic base fee
    });
    expect(breakdown.totalFeeStroops).toBe(100);
    expect(breakdown.totalFeeXlm).toBeCloseTo(0.00001, 10);
  });
});

// ---------------------------------------------------------------------------
// end-to-end breakdown
// ---------------------------------------------------------------------------

describe('estimateTransactionCost', () => {
  it('produces a breakdown whose components sum to the total', () => {
    const usage = coinflipDuelUsage();
    const rent = [{ entrySizeBytes: 1_024, extensionLedgers: 100 }];
    const breakdown = estimateTransactionCost(usage, rent);

    const sumOfParts =
      breakdown.computeFee +
      breakdown.readFee +
      breakdown.writeFee +
      breakdown.transactionSizeFee +
      breakdown.eventsFee +
      breakdown.rentFee +
      breakdown.baseFee;
    expect(breakdown.totalFeeStroops).toBe(sumOfParts);
    expect(breakdown.nonRefundableResourceFee + breakdown.refundableResourceFee).toBe(breakdown.resourceFee);
    expect(breakdown.resourceFee + breakdown.baseFee).toBe(breakdown.totalFeeStroops);
  });

  it('scales the base fee with operationCount', () => {
    const usage = coinflipDuelUsage();
    const single = estimateTransactionCost({ ...usage, operationCount: 1 });
    const triple = estimateTransactionCost({ ...usage, operationCount: 3 });
    expect(triple.baseFee).toBe(single.baseFee * 3);
  });

  it('respects a partial fee-rate override', () => {
    const usage = coinflipDuelUsage();
    const withCustomRate = estimateTransactionCost(usage, [], {
      ...DEFAULT_FEE_RATES,
      feePerInstructionIncrement: 100,
    });
    expect(withCustomRate.computeFee).toBe(Math.ceil(usage.cpuInstructions / 10_000) * 100);
  });

  it('formats a breakdown into a human-readable report containing the total', () => {
    const usage = coinflipDuelUsage();
    const breakdown = estimateTransactionCost(usage);
    const report = formatBreakdown(breakdown);
    expect(report).toContain('Transaction Cost Breakdown');
    expect(report).toContain('Total');
    expect(report).toContain(breakdown.totalFeeStroops.toLocaleString());
  });
});
