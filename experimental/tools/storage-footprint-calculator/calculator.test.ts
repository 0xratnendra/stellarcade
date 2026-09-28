import { describe, expect, it } from 'vitest';
import { calculateSerializedByteSize, calculateStorageRent, compareStorageTypes, renderComparisonTable, SOROBAN_RENT_FEE_PER_KB } from './calculator';

describe('storage footprint calculator', () => {
  it('calculates byte size from serialized XDR-like data', () => {
    const size = calculateSerializedByteSize('{"key":"value"}');
    expect(size).toBe(Buffer.byteLength('{"key":"value"}', 'utf8'));
  });

  it('matches Soroban rent formula for persistent storage', () => {
    const estimate = calculateStorageRent({ bytes: 2048, type: 'persistent', ledgers: 12 });
    const expected = Math.max(1, Math.ceil(2048 / 1024)) * SOROBAN_RENT_FEE_PER_KB * 12;
    expect(estimate.totalRent).toBe(expected);
  });

  it('renders all storage type comparisons', () => {
    const table = renderComparisonTable(compareStorageTypes(4096, 4));
    expect(table).toContain('instance');
    expect(table).toContain('persistent');
    expect(table).toContain('temporary');
  });
});
