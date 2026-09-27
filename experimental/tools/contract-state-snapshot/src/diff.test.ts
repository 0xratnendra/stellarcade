import { describe, it, expect } from 'vitest';
import { diffSnapshots, formatDiff } from './diff';
import { ContractSnapshot, StorageEntrySnapshot } from '../types';

function entry(overrides: Partial<StorageEntrySnapshot>): StorageEntrySnapshot {
  return {
    durability: 'persistent',
    keyDisplay: '"KEY"',
    keyXdr: 'AAAA',
    value: null,
    valueXdr: null,
    missing: false,
    liveUntilLedgerSeq: null,
    ...overrides,
  };
}

function snapshot(entries: StorageEntrySnapshot[], contractId = 'CCONTRACT'): ContractSnapshot {
  return { contractId, network: 'testnet', capturedAt: '2026-01-01T00:00:00.000Z', latestLedger: 1, entries };
}

// ---------------------------------------------------------------------------
// state snapshot diff detects added and modified keys
// ---------------------------------------------------------------------------

describe('diffSnapshots', () => {
  it('detects an added key present only in the second snapshot', () => {
    const before = snapshot([entry({ keyDisplay: '"A"', value: 1 })]);
    const after = snapshot([entry({ keyDisplay: '"A"', value: 1 }), entry({ keyDisplay: '"B"', value: 2 })]);

    const diff = diffSnapshots(before, after);
    expect(diff.addedCount).toBe(1);
    expect(diff.entries.find((e) => e.keyDisplay === '"B"')?.changeType).toBe('added');
  });

  it('detects a removed key present only in the first snapshot', () => {
    const before = snapshot([entry({ keyDisplay: '"A"', value: 1 }), entry({ keyDisplay: '"B"', value: 2 })]);
    const after = snapshot([entry({ keyDisplay: '"A"', value: 1 })]);

    const diff = diffSnapshots(before, after);
    expect(diff.removedCount).toBe(1);
    expect(diff.entries.find((e) => e.keyDisplay === '"B"')?.changeType).toBe('removed');
  });

  it('detects a modified key whose value changed between snapshots', () => {
    const before = snapshot([entry({ keyDisplay: '"BALANCE"', value: '100' })]);
    const after = snapshot([entry({ keyDisplay: '"BALANCE"', value: '250' })]);

    const diff = diffSnapshots(before, after);
    expect(diff.modifiedCount).toBe(1);
    const modified = diff.entries.find((e) => e.keyDisplay === '"BALANCE"')!;
    expect(modified.changeType).toBe('modified');
    expect(modified.before).toBe('100');
    expect(modified.after).toBe('250');
  });

  it('reports a key with an unchanged value as unchanged', () => {
    const before = snapshot([entry({ keyDisplay: '"STATIC"', value: 'same' })]);
    const after = snapshot([entry({ keyDisplay: '"STATIC"', value: 'same' })]);

    const diff = diffSnapshots(before, after);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.modifiedCount).toBe(0);
  });

  it('does not report a modification for a value whose object keys are merely reordered', () => {
    const before = snapshot([entry({ keyDisplay: '"CFG"', value: { a: 1, b: 2 } })]);
    const after = snapshot([entry({ keyDisplay: '"CFG"', value: { b: 2, a: 1 } })]);

    const diff = diffSnapshots(before, after);
    expect(diff.unchangedCount).toBe(1);
    expect(diff.modifiedCount).toBe(0);
  });

  it('treats a key becoming missing (deleted on-chain) as modified, not just a value change', () => {
    const before = snapshot([entry({ keyDisplay: '"K"', value: 42, missing: false })]);
    const after = snapshot([entry({ keyDisplay: '"K"', value: null, missing: true })]);

    const diff = diffSnapshots(before, after);
    expect(diff.entries.find((e) => e.keyDisplay === '"K"')?.changeType).toBe('modified');
  });

  it('handles multiple simultaneous added, removed, and modified keys in one diff', () => {
    const before = snapshot([
      entry({ keyDisplay: '"KEEP"', value: 1 }),
      entry({ keyDisplay: '"CHANGE"', value: 'old' }),
      entry({ keyDisplay: '"GONE"', value: 'x' }),
    ]);
    const after = snapshot([
      entry({ keyDisplay: '"KEEP"', value: 1 }),
      entry({ keyDisplay: '"CHANGE"', value: 'new' }),
      entry({ keyDisplay: '"NEW"', value: 'y' }),
    ]);

    const diff = diffSnapshots(before, after);
    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.modifiedCount).toBe(1);
    expect(diff.unchangedCount).toBe(1);
  });

  it('formats a diff report listing only changed keys, omitting unchanged ones', () => {
    const before = snapshot([entry({ keyDisplay: '"SAME"', value: 1 }), entry({ keyDisplay: '"CHANGED"', value: 1 })]);
    const after = snapshot([entry({ keyDisplay: '"SAME"', value: 1 }), entry({ keyDisplay: '"CHANGED"', value: 2 })]);

    const report = formatDiff(diffSnapshots(before, after));
    expect(report).toContain('"CHANGED"');
    expect(report).not.toContain('~ "SAME"');
  });
});
