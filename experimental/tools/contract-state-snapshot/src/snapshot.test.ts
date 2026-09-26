import { describe, it, expect } from 'vitest';
import { Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { captureSnapshot, LedgerEntryFetcher } from './snapshot';
import { buildStorageKey } from './decode';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';

function makeContractDataEntry(key: xdr.ScVal, val: xdr.ScVal): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(CONTRACT_ID).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
      val,
    })
  );
}

describe('captureSnapshot', () => {
  it('always includes the instance entry, plus every requested persistent key', async () => {
    const instanceVal = nativeToScVal({ admin: 'GABC' });
    const balanceVal = nativeToScVal(500n, { type: 'i128' });

    const fetchEntries: LedgerEntryFetcher = async (keys) => {
      const entries = keys
        .map((key) => {
          if (key.contractData().key().switch().name === 'scvLedgerKeyContractInstance') {
            return { key, val: makeContractDataEntry(key.contractData().key(), instanceVal) };
          }
          if (buildKeyMatches(key, 'BALANCE')) {
            return { key, val: makeContractDataEntry(key.contractData().key(), balanceVal) };
          }
          return null;
        })
        .filter((e): e is { key: xdr.LedgerKey; val: xdr.LedgerEntryData } => e !== null);
      return { entries, latestLedger: 12345 };
    };

    function buildKeyMatches(key: xdr.LedgerKey, symbol: string): boolean {
      return key.toXDR('base64') === buildStorageKey(CONTRACT_ID, 'persistent', symbol).toXDR('base64');
    }

    const snapshot = await captureSnapshot(CONTRACT_ID, 'testnet', ['BALANCE'], 'persistent', fetchEntries);

    expect(snapshot.latestLedger).toBe(12345);
    expect(snapshot.entries).toHaveLength(2);

    const instanceEntry = snapshot.entries.find((e) => e.durability === 'instance')!;
    expect(instanceEntry.missing).toBe(false);
    expect(instanceEntry.value).toEqual({ admin: 'GABC' });

    const balanceEntry = snapshot.entries.find((e) => e.keyDisplay === '"BALANCE"')!;
    expect(balanceEntry.missing).toBe(false);
    expect(balanceEntry.value).toBe('500');
  });

  it('marks a requested key absent from the RPC response as missing', async () => {
    const fetchEntries: LedgerEntryFetcher = async () => ({ entries: [], latestLedger: 100 });
    const snapshot = await captureSnapshot(CONTRACT_ID, 'testnet', ['NEVER_WRITTEN'], 'persistent', fetchEntries);

    const instanceEntry = snapshot.entries.find((e) => e.durability === 'instance')!;
    expect(instanceEntry.missing).toBe(true);

    const requestedEntry = snapshot.entries.find((e) => e.keyDisplay === '"NEVER_WRITTEN"')!;
    expect(requestedEntry.missing).toBe(true);
    expect(requestedEntry.value).toBeNull();
  });

  it('fetches only the instance entry when no keys are requested', async () => {
    let requestedKeyCount = 0;
    const fetchEntries: LedgerEntryFetcher = async (keys) => {
      requestedKeyCount = keys.length;
      return { entries: [], latestLedger: 1 };
    };

    await captureSnapshot(CONTRACT_ID, 'testnet', [], 'persistent', fetchEntries);
    expect(requestedKeyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. invalid contract ID handling
// ---------------------------------------------------------------------------

describe('captureSnapshot: invalid contract ID handling', () => {
  const neverCalled: LedgerEntryFetcher = async () => {
    throw new Error('fetchEntries should never be called for an invalid contract ID');
  };

  it('rejects a malformed contract ID before making any RPC call', async () => {
    await expect(captureSnapshot('not-a-real-contract-id', 'testnet', [], 'persistent', neverCalled)).rejects.toThrow(
      /invalid contract id/i
    );
  });

  it('rejects a well-formed but wrong-type strkey (an account G... address, not a contract C...)', async () => {
    const accountAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    await expect(captureSnapshot(accountAddress, 'testnet', [], 'persistent', neverCalled)).rejects.toThrow(
      /invalid contract id/i
    );
  });

  it('rejects an empty contract ID string', async () => {
    await expect(captureSnapshot('', 'testnet', [], 'persistent', neverCalled)).rejects.toThrow(/invalid contract id/i);
  });

  it('accepts a well-formed contract ID and proceeds to fetch', async () => {
    const fetchEntries: LedgerEntryFetcher = async () => ({ entries: [], latestLedger: 1 });
    await expect(captureSnapshot(CONTRACT_ID, 'testnet', [], 'persistent', fetchEntries)).resolves.toBeDefined();
  });
});
