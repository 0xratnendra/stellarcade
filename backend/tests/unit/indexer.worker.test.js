/**
 * Unit tests for the coin-flip event indexer, run against the in-memory
 * SQLite database from tests/setup.js (real migrations, real Game/User/Quest
 * models) with a stubbed Soroban RPC.
 */
const StellarSdk = require('@stellar/stellar-sdk');

const mockLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => mockLogger);

const db = require('../../src/config/database');
const { createIndexer, stroopsToUnits } = require('../../src/services/indexer.worker');

const COIN_FLIP_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 2));
const LINKED_PLAYER = StellarSdk.Keypair.random().publicKey();
const ANON_PLAYER = StellarSdk.Keypair.random().publicKey();
const PLACE_TX = '1f'.repeat(32);
const RESOLVE_TX = '2e'.repeat(32);

const entry = (key, val) =>
  new StellarSdk.xdr.ScMapEntry({ key: StellarSdk.xdr.ScVal.scvSymbol(key), val });

const topics = (name, gameId, player) => [
  StellarSdk.xdr.ScVal.scvSymbol(name),
  StellarSdk.nativeToScVal(BigInt(gameId), { type: 'u64' }),
  new StellarSdk.Address(player).toScVal(),
];

/** BetPlaced exactly as coin-flip emits it: data map { side: u32, wager: i128 }. */
const betPlaced = ({ id, gameId, player, side = 0, wager = 25_000_000n }) => ({
  id,
  txHash: PLACE_TX,
  ledger: 500,
  ledgerClosedAt: '2026-10-01T12:00:00Z',
  inSuccessfulContractCall: true,
  topic: topics('bet_placed', gameId, player),
  value: StellarSdk.xdr.ScVal.scvMap([
    entry('side', StellarSdk.nativeToScVal(side, { type: 'u32' })),
    entry('wager', StellarSdk.nativeToScVal(wager, { type: 'i128' })),
  ]),
});

/** BetResolved: data map { payout: i128, won: bool }. */
const betResolved = ({ id, gameId, player, won = true, payout = 49_000_000n }) => ({
  id,
  txHash: RESOLVE_TX,
  ledger: 502,
  ledgerClosedAt: '2026-10-01T12:00:10Z',
  inSuccessfulContractCall: true,
  topic: topics('bet_resolved', gameId, player),
  value: StellarSdk.xdr.ScVal.scvMap([
    entry('payout', StellarSdk.nativeToScVal(payout, { type: 'i128' })),
    entry('won', StellarSdk.xdr.ScVal.scvBool(won)),
  ]),
});

const makeSoroban = (pages = []) => ({
  simulate: jest.fn(),
  getLatestLedger: jest.fn(async () => 400),
  getEvents: jest.fn(async () => pages.shift() || { events: [], cursor: null }),
});

const makeIndexer = (soroban) => createIndexer({ db, soroban, contractId: COIN_FLIP_ID });

const gameRow = (gameId) =>
  db('games').where({ contract_id: COIN_FLIP_ID, chain_game_id: gameId }).first();

const questProgress = async (userId, slug) => {
  const row = await db('user_quests')
    .join('quests', 'user_quests.quest_id', 'quests.id')
    .where({ 'user_quests.user_id': userId, 'quests.quest_id': slug })
    .first('user_quests.progress');
  return row ? row.progress : 0;
};

let linkedUserId;

beforeAll(async () => {
  await db.migrate.latest();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await db('user_quests').del();
  await db('games').del();
  await db('users').del();
  await db('worker_cursors').del();
  [linkedUserId] = (
    await db('users').insert({ wallet_address: LINKED_PLAYER }).returning('id')
  ).map((r) => (typeof r === 'object' ? r.id : r));
});

afterAll(async () => {
  await db.destroy();
});

describe('indexer worker', () => {
  test('BetPlaced creates a pending row with the real tx hash', async () => {
    const soroban = makeSoroban([
      {
        events: [betPlaced({ id: 'e1', gameId: 11, player: LINKED_PLAYER, side: 1 })],
        cursor: 'e1',
      },
    ]);

    await makeIndexer(soroban).processEvents();

    const row = await gameRow('11');
    expect(row).toMatchObject({
      contract_id: COIN_FLIP_ID,
      player_address: LINKED_PLAYER,
      user_id: linkedUserId,
      game_type: 'coin-flip',
      side: 'tails',
      result: 'pending',
      status: 'pending',
      tx_hash: PLACE_TX,
      ledger: 500,
    });
    expect(row.tx_hash).toHaveLength(64);
    expect(row.tx_hash.startsWith('0x')).toBe(false);
    expect(Number(row.bet_amount)).toBe(2.5);
  });

  test('BetResolved updates the same row and records quest progress', async () => {
    const soroban = makeSoroban([
      {
        events: [
          betPlaced({ id: 'e1', gameId: 12, player: LINKED_PLAYER }),
          betResolved({ id: 'e2', gameId: 12, player: LINKED_PLAYER, won: true }),
        ],
        cursor: 'e2',
      },
    ]);

    await makeIndexer(soroban).processEvents();

    expect(await db('games').count('* as n').first()).toMatchObject({ n: 1 });
    const row = await gameRow('12');
    expect(row).toMatchObject({
      status: 'resolved',
      result: 'win',
      tx_hash: PLACE_TX,
      resolve_tx_hash: RESOLVE_TX,
    });
    expect(Number(row.payout)).toBe(4.9);
    expect(await questProgress(linkedUserId, 'play-5-games')).toBe(1);
    expect(await questProgress(linkedUserId, 'win-3-games')).toBe(1);
  });

  test('a lost bet counts toward play-5-games but not win-3-games', async () => {
    const soroban = makeSoroban([
      {
        events: [
          betPlaced({ id: 'e1', gameId: 13, player: LINKED_PLAYER }),
          betResolved({ id: 'e2', gameId: 13, player: LINKED_PLAYER, won: false, payout: 0n }),
        ],
        cursor: 'e2',
      },
    ]);

    await makeIndexer(soroban).processEvents();

    expect((await gameRow('13')).result).toBe('loss');
    expect(await questProgress(linkedUserId, 'play-5-games')).toBe(1);
    expect(await questProgress(linkedUserId, 'win-3-games')).toBe(0);
  });

  test('replaying a batch of events is idempotent, including quest progress', async () => {
    const batch = () => [
      betPlaced({ id: 'e1', gameId: 14, player: LINKED_PLAYER }),
      betResolved({ id: 'e2', gameId: 14, player: LINKED_PLAYER, won: true }),
    ];
    await makeIndexer(makeSoroban([{ events: batch(), cursor: 'e2' }])).processEvents();
    const before = await gameRow('14');

    // Lose the cursor so the same events are delivered again.
    await db('worker_cursors').del();
    await makeIndexer(makeSoroban([{ events: batch(), cursor: 'e2' }])).processEvents();

    expect(await db('games').count('* as n').first()).toMatchObject({ n: 1 });
    expect(await gameRow('14')).toEqual(before);
    expect(await questProgress(linkedUserId, 'play-5-games')).toBe(1);
    expect(await questProgress(linkedUserId, 'win-3-games')).toBe(1);
  });

  test('an event from a wallet with no user account is still indexed', async () => {
    const soroban = makeSoroban([
      {
        events: [
          betPlaced({ id: 'e1', gameId: 15, player: ANON_PLAYER }),
          betResolved({ id: 'e2', gameId: 15, player: ANON_PLAYER }),
        ],
        cursor: 'e2',
      },
    ]);

    await makeIndexer(soroban).processEvents();

    const row = await gameRow('15');
    expect(row).toMatchObject({ player_address: ANON_PLAYER, user_id: null, status: 'resolved' });
    expect(await db('user_quests').count('* as n').first()).toMatchObject({ n: 0 });

    // And it shows up in /games/recent with the on-chain address as user_wallet.
    const GameModel = require('../../src/models/Game.model');
    const { items } = await GameModel.findRecent({ page: 1, limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0].user_wallet).toBe(ANON_PLAYER);
  });

  test('resumes from the saved cursor after a restart', async () => {
    const first = makeSoroban([
      { events: [betPlaced({ id: 'e1', gameId: 16, player: LINKED_PLAYER })], cursor: 'e1' },
    ]);
    await makeIndexer(first).processEvents();
    expect(first.getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 400 });

    const second = makeSoroban([{ events: [], cursor: 'e1' }]);
    await makeIndexer(second).processEvents();
    expect(second.getEvents.mock.calls[0][0]).toMatchObject({ cursor: 'e1' });
    expect(second.getEvents.mock.calls[0][0].startLedger).toBeUndefined();
  });

  test('BetResolved for a bet placed before the start ledger reads the bet from the contract', async () => {
    const soroban = makeSoroban([
      {
        events: [
          betResolved({ id: 'e1', gameId: 17, player: ANON_PLAYER, won: false, payout: 0n }),
        ],
        cursor: 'e1',
      },
    ]);
    soroban.simulate.mockResolvedValue({
      player: ANON_PLAYER,
      side: 0,
      wager: 10_000_000n,
      resolved: true,
      won: false,
      payout: 0n,
    });

    await makeIndexer(soroban).processEvents();

    expect(soroban.simulate).toHaveBeenCalledWith(COIN_FLIP_ID, 'get_game', expect.any(Array));
    const row = await gameRow('17');
    expect(row).toMatchObject({ status: 'resolved', result: 'loss', side: 'heads', tx_hash: null });
    expect(Number(row.bet_amount)).toBe(1);
  });
});

describe('stroopsToUnits', () => {
  test('converts exactly without floating point', () => {
    expect(stroopsToUnits(25_000_000n)).toBe('2.5000000');
    expect(stroopsToUnits(1n)).toBe('0.0000001');
    expect(stroopsToUnits(0n)).toBe('0.0000000');
    expect(stroopsToUnits(123456789012345678901n)).toBe('12345678901234.5678901');
  });
});
