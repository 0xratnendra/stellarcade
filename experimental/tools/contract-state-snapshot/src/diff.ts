import { ContractSnapshot, DiffEntry, SnapshotDiff } from '../types';

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

/**
 * Diff two snapshots by matching entries on `(durability, keyDisplay)`.
 * A key present in only one snapshot is `added`/`removed`; a key present
 * in both with a different decoded value is `modified`; otherwise
 * `unchanged`. Values are compared via a stable (key-order-independent)
 * JSON serialization, so a Map whose fields happen to decode in a
 * different order does not register as a false-positive modification.
 */
export function diffSnapshots(before: ContractSnapshot, after: ContractSnapshot): SnapshotDiff {
  const beforeByKey = new Map(before.entries.map((e) => [`${e.durability}:${e.keyDisplay}`, e]));
  const afterByKey = new Map(after.entries.map((e) => [`${e.durability}:${e.keyDisplay}`, e]));

  const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const entries: DiffEntry[] = [];

  for (const compositeKey of allKeys) {
    const beforeEntry = beforeByKey.get(compositeKey);
    const afterEntry = afterByKey.get(compositeKey);
    const keyDisplay = (afterEntry ?? beforeEntry)!.keyDisplay;

    if (beforeEntry && !afterEntry) {
      entries.push({ keyDisplay, changeType: 'removed', before: beforeEntry.value, after: undefined });
    } else if (!beforeEntry && afterEntry) {
      entries.push({ keyDisplay, changeType: 'added', before: undefined, after: afterEntry.value });
    } else if (beforeEntry && afterEntry) {
      const beforeMissing = beforeEntry.missing;
      const afterMissing = afterEntry.missing;
      const changed = beforeMissing !== afterMissing || stableStringify(beforeEntry.value) !== stableStringify(afterEntry.value);
      entries.push({
        keyDisplay,
        changeType: changed ? 'modified' : 'unchanged',
        before: beforeEntry.value,
        after: afterEntry.value,
      });
    }
  }

  return {
    contractIdBefore: before.contractId,
    contractIdAfter: after.contractId,
    entries,
    addedCount: entries.filter((e) => e.changeType === 'added').length,
    removedCount: entries.filter((e) => e.changeType === 'removed').length,
    modifiedCount: entries.filter((e) => e.changeType === 'modified').length,
    unchangedCount: entries.filter((e) => e.changeType === 'unchanged').length,
  };
}

export function formatDiff(diff: SnapshotDiff): string {
  const lines: string[] = [
    `Diff: ${diff.contractIdBefore} -> ${diff.contractIdAfter}`,
    `Added: ${diff.addedCount}  Removed: ${diff.removedCount}  Modified: ${diff.modifiedCount}  Unchanged: ${diff.unchangedCount}`,
    '',
  ];
  for (const entry of diff.entries) {
    if (entry.changeType === 'unchanged') continue;
    const symbol = entry.changeType === 'added' ? '+' : entry.changeType === 'removed' ? '-' : '~';
    lines.push(`${symbol} ${entry.keyDisplay}`);
    if (entry.changeType !== 'added') lines.push(`    before: ${JSON.stringify(entry.before)}`);
    if (entry.changeType !== 'removed') lines.push(`    after:  ${JSON.stringify(entry.after)}`);
  }
  return lines.join('\n');
}
