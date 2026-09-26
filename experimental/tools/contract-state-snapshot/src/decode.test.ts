import { describe, it, expect } from 'vitest';
import { Address, rpc, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { buildStorageKey, decodeEntry, renderKeyDisplay, bigintSafe } from './decode';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4';

/** Build a real `ContractDataEntry` (via the SDK's own XDR constructors,
 * not a hand-rolled mock) so decode tests exercise genuine XDR
 * encode/decode, matching how a real `getLedgerEntries` response is
 * shaped. */
function makeContractDataEntry(
  key: xdr.ScVal,
  val: xdr.ScVal,
  durability: xdr.ContractDataDurability = xdr.ContractDataDurability.persistent()
): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: new Address(CONTRACT_ID).toScAddress(),
      key,
      durability,
      val,
    })
  );
}

// ---------------------------------------------------------------------------
// 1. decoding SCVal storage entries into JSON
// ---------------------------------------------------------------------------

describe('decodeEntry: decoding SCVal storage entries into JSON', () => {
  it('decodes a Symbol-keyed i128 entry', () => {
    const keyScVal = nativeToScVal('BALANCE', { type: 'symbol' });
    const key = buildStorageKey(CONTRACT_ID, 'persistent', 'BALANCE');
    const val = nativeToScVal(1_000n, { type: 'i128' });
    const entryData = makeContractDataEntry(keyScVal, val);

    const result: rpc.Api.LedgerEntryResult = { key, val: entryData, liveUntilLedgerSeq: 500_000 };
    const snapshot = decodeEntry('persistent', key, result);

    expect(snapshot.value).toBe('1000');
    expect(snapshot.keyDisplay).toBe('"BALANCE"');
    expect(snapshot.missing).toBe(false);
    expect(snapshot.liveUntilLedgerSeq).toBe(500_000);
  });

  it('decodes an Address value', () => {
    const holder = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const keyScVal = nativeToScVal('ADMIN', { type: 'symbol' });
    const key = buildStorageKey(CONTRACT_ID, 'persistent', 'ADMIN');
    const val = new Address(holder).toScVal();
    const entryData = makeContractDataEntry(keyScVal, val);

    const result: rpc.Api.LedgerEntryResult = { key, val: entryData };
    const snapshot = decodeEntry('persistent', key, result);
    expect(snapshot.value).toBe(holder);
  });

  it('decodes a Vec of integers', () => {
    const keyScVal = nativeToScVal('LIST', { type: 'symbol' });
    const key = buildStorageKey(CONTRACT_ID, 'persistent', 'LIST');
    const val = nativeToScVal([1, 2, 3]);
    const entryData = makeContractDataEntry(keyScVal, val);

    const result: rpc.Api.LedgerEntryResult = { key, val: entryData };
    const snapshot = decodeEntry('persistent', key, result);
    expect(snapshot.value).toEqual(['1', '2', '3']);
  });

  it('decodes a Map into a plain object', () => {
    const keyScVal = nativeToScVal('CONFIG', { type: 'symbol' });
    const key = buildStorageKey(CONTRACT_ID, 'persistent', 'CONFIG');
    const val = nativeToScVal({ threshold: 5, active: true });
    const entryData = makeContractDataEntry(keyScVal, val);

    const result: rpc.Api.LedgerEntryResult = { key, val: entryData };
    const snapshot = decodeEntry('persistent', key, result);
    expect(snapshot.value).toEqual({ threshold: '5', active: true });
  });

  it('decodes the contract instance entry distinctly from a regular key', () => {
    const key = buildStorageKey(CONTRACT_ID, 'instance');
    expect(key.contractData().key().switch().name).toBe('scvLedgerKeyContractInstance');
  });

  it('marks a missing entry distinctly from a present entry decoding to null', () => {
    const key = buildStorageKey(CONTRACT_ID, 'persistent', 'NEVER_WRITTEN');
    const missingSnapshot = decodeEntry('persistent', key, null);
    expect(missingSnapshot.missing).toBe(true);
    expect(missingSnapshot.value).toBeNull();

    const keyScVal = nativeToScVal('VOID_VALUE', { type: 'symbol' });
    const presentKey = buildStorageKey(CONTRACT_ID, 'persistent', 'VOID_VALUE');
    const entryData = makeContractDataEntry(keyScVal, xdr.ScVal.scvVoid());
    const presentSnapshot = decodeEntry('persistent', presentKey, { key: presentKey, val: entryData });
    expect(presentSnapshot.missing).toBe(false);
    expect(presentSnapshot.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bigintSafe / renderKeyDisplay
// ---------------------------------------------------------------------------

describe('bigintSafe', () => {
  it('stringifies top-level and nested bigints without losing precision', () => {
    const huge = 170141183460469231731687303715884105727n; // near i128 max
    expect(bigintSafe(huge)).toBe(huge.toString());
    expect(bigintSafe({ a: huge, b: [huge, 1] })).toEqual({ a: huge.toString(), b: [huge.toString(), 1] });
  });

  it('leaves non-bigint values untouched', () => {
    expect(bigintSafe({ a: 'x', b: true, c: null })).toEqual({ a: 'x', b: true, c: null });
  });
});

describe('renderKeyDisplay', () => {
  it('renders the instance key as a fixed marker', () => {
    expect(renderKeyDisplay('instance', xdr.ScVal.scvLedgerKeyContractInstance())).toBe('<instance>');
  });

  it('renders a Symbol key as its quoted string value', () => {
    const key = nativeToScVal('MY_KEY', { type: 'symbol' });
    expect(renderKeyDisplay('persistent', key)).toBe('"MY_KEY"');
  });
});
