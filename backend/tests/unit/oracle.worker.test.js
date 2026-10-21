/**
 * Unit tests for the RNG oracle worker, run against the in-memory SQLite
 * database from tests/setup.js (real migrations) with a stubbed Soroban RPC.
 */
const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');

const mockLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
jest.mock('../../src/utils/logger', () => mockLogger);

const db = require('../../src/config/database');
const {
  createOracle,
  RNG_ERROR_ALREADY_FULFILLED,
  COIN_FLIP_ERROR_GAME_ALREADY_RESOLVED,
} = require('../../src/services/oracle.worker');

const ORACLE = StellarSdk.Keypair.random();
const RNG_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
const COIN_FLIP_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 2));
const DICE_ROLL_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 4));
const OTHER_GAME_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 3));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();

const contractError = (code) =>
  Object.assign(new Error(`HostError: Error(Contract, #${code})`), {
    code: 'NETWORK_ERROR',
    contractErrorCode: code,
  });

/** Builds a RandomRequested event exactly as the contract emits it. */
const randomRequestedEvent = ({ id, requestId, caller, commitment }) => ({
  id,
  txHash: 'a'.repeat(64),
  ledger: 100,
  inSuccessfulContractCall: true,
  topic: [
    StellarSdk.xdr.ScVal.scvSymbol('random_requested'),
    StellarSdk.nativeToScVal(BigInt(requestId), { type: 'u64' }),
    new StellarSdk.Address(caller).toScVal(),
  ],
  value: StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('commitment'),
      val: StellarSdk.xdr.ScVal.scvBytes(commitment),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol('max'),
      val: StellarSdk.nativeToScVal(2n, { type: 'u64' }),
    }),
  ]),
});

const storeSeed = async () => {
  const seed = crypto.randomBytes(32);
  const commitment = sha256(seed);
  await db('oracle_seeds').insert({
    seed: seed.toString('hex'),
    commitment: commitment.toString('hex'),
    status: 'committed',
  });
  return { seed, commitment };
};

/** Decodes the ScVal args the worker passed to soroban.invoke. */
const invokeCalls = (soroban, method) =>
  soroban.invoke.mock.calls
    .filter(([, m]) => m === method)
    .map(([contractId, , args]) => ({
      contractId,
      args: args.map((arg) => StellarSdk.scValToNative(arg)),
    }));

const makeSoroban = ({ queueLen = 50, pages = [] } = {}) => ({
  simulate: jest.fn(async (_id, method) => {
    if (method === 'get_commitment_queue_len') return queueLen;
    throw new Error(`unexpected simulate ${method}`);
  }),
  invoke: jest.fn(async () => ({ txHash: 'b'.repeat(64), returnValue: null, ledger: 101 })),
  getLatestLedger: jest.fn(async () => 90),
  getEvents: jest.fn(async () => pages.shift() || { events: [], cursor: null }),
});

const makeOracle = (soroban) =>
  createOracle({
    db,
    soroban,
    secretKey: ORACLE.secret(),
    rngContractId: RNG_ID,
    coinFlipContractId: COIN_FLIP_ID,
    diceRollContractId: DICE_ROLL_ID,
    minQueue: 20,
  });

beforeAll(async () => {
  await db.migrate.latest();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await db('oracle_seeds').del();
  await db('worker_cursors').del();
});

afterAll(async () => {
  await db.destroy();
});

describe('oracle worker — fulfilment', () => {
  test('fulfils a request with the seed matching its commitment, then resolves the bet', async () => {
    const { seed, commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({ id: 'ev-1', requestId: 42, caller: COIN_FLIP_ID, commitment }),
          ],
          cursor: 'ev-1',
        },
      ],
    });

    await makeOracle(soroban).processRequests();

    const fulfils = invokeCalls(soroban, 'fulfill_random');
    expect(fulfils).toHaveLength(1);
    expect(fulfils[0].contractId).toBe(RNG_ID);
    expect(fulfils[0].args[0]).toBe(ORACLE.publicKey());
    expect(fulfils[0].args[1]).toBe(42n);
    expect(Buffer.from(fulfils[0].args[2]).equals(seed)).toBe(true);

    const resolves = invokeCalls(soroban, 'resolve_bet');
    expect(resolves).toEqual([{ contractId: COIN_FLIP_ID, args: [42n] }]);

    // fulfill_random must land before resolve_bet.
    const methods = soroban.invoke.mock.calls.map(([, m]) => m);
    expect(methods).toEqual(['fulfill_random', 'resolve_bet']);

    const row = await db('oracle_seeds')
      .where({ commitment: commitment.toString('hex') })
      .first();
    expect(row.status).toBe('revealed');
    expect(String(row.request_id)).toBe('42');
  });

  test('routes dice-roll requests to resolve_roll', async () => {
    const { commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({
              id: 'ev-dice',
              requestId: 19,
              caller: DICE_ROLL_ID,
              commitment,
            }),
          ],
          cursor: 'ev-dice',
        },
      ],
    });

    await makeOracle(soroban).processRequests();

    expect(invokeCalls(soroban, 'resolve_roll')).toEqual([
      { contractId: DICE_ROLL_ID, args: [19n] },
    ]);
    expect(invokeCalls(soroban, 'resolve_bet')).toHaveLength(0);
  });

  test('does not call resolve_bet for requests from other game contracts', async () => {
    const { commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({ id: 'ev-1', requestId: 7, caller: OTHER_GAME_ID, commitment }),
          ],
          cursor: 'ev-1',
        },
      ],
    });

    await makeOracle(soroban).processRequests();

    expect(invokeCalls(soroban, 'fulfill_random')).toHaveLength(1);
    expect(invokeCalls(soroban, 'resolve_bet')).toHaveLength(0);
  });

  test('treats AlreadyFulfilled and GameAlreadyResolved as success', async () => {
    const { commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({ id: 'ev-1', requestId: 5, caller: COIN_FLIP_ID, commitment }),
          ],
          cursor: 'ev-1',
        },
      ],
    });
    soroban.invoke.mockImplementation(async (_id, method) => {
      if (method === 'fulfill_random') throw contractError(RNG_ERROR_ALREADY_FULFILLED);
      throw contractError(COIN_FLIP_ERROR_GAME_ALREADY_RESOLVED);
    });

    await expect(makeOracle(soroban).processRequests()).resolves.toBe(1);

    const row = await db('oracle_seeds')
      .where({ commitment: commitment.toString('hex') })
      .first();
    expect(row.status).toBe('revealed');
    expect(await db('worker_cursors').where({ name: 'oracle' }).first()).toMatchObject({
      cursor: 'ev-1',
    });
  });

  test('a failed fulfil does not advance the cursor and never logs the seed', async () => {
    const { seed, commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({ id: 'ev-1', requestId: 9, caller: COIN_FLIP_ID, commitment }),
          ],
          cursor: 'ev-1',
        },
      ],
    });
    // Simulation diagnostics can echo the invocation args, seed included.
    soroban.invoke.mockRejectedValue(
      Object.assign(new Error(`simulation failed: args=[${seed.toString('hex')}]`), {
        code: 'NETWORK_ERROR',
        contractErrorCode: null,
      })
    );

    const oracle = makeOracle(soroban);
    await oracle.runCycle();

    expect(await db('worker_cursors').where({ name: 'oracle' }).first()).toBeUndefined();
    const row = await db('oracle_seeds')
      .where({ commitment: commitment.toString('hex') })
      .first();
    expect(row.status).toBe('bound');

    const logged = JSON.stringify([
      mockLogger.error.mock.calls,
      mockLogger.info.mock.calls,
      mockLogger.warn.mock.calls,
    ]);
    expect(logged).not.toContain(seed.toString('hex'));
  });

  test('never re-uses a seed for a second request', async () => {
    const { commitment } = await storeSeed();
    const soroban = makeSoroban({
      pages: [
        {
          events: [
            randomRequestedEvent({ id: 'ev-1', requestId: 1, caller: COIN_FLIP_ID, commitment }),
            randomRequestedEvent({ id: 'ev-2', requestId: 2, caller: COIN_FLIP_ID, commitment }),
          ],
          cursor: 'ev-2',
        },
      ],
    });

    await makeOracle(soroban).processRequests();

    const fulfils = invokeCalls(soroban, 'fulfill_random');
    expect(fulfils.map((c) => c.args[1])).toEqual([1n]);
  });
});

describe('oracle worker — restart', () => {
  test('resumes from the saved cursor and skips handled events', async () => {
    const first = await storeSeed();
    const second = await storeSeed();
    const ev1 = randomRequestedEvent({
      id: 'ev-1',
      requestId: 1,
      caller: COIN_FLIP_ID,
      commitment: first.commitment,
    });
    const ev2 = randomRequestedEvent({
      id: 'ev-2',
      requestId: 2,
      caller: COIN_FLIP_ID,
      commitment: second.commitment,
    });

    const before = makeSoroban({ pages: [{ events: [ev1], cursor: 'ev-1' }] });
    await makeOracle(before).processRequests();
    expect(before.getEvents.mock.calls[0][0]).toMatchObject({ startLedger: 90 });

    // A fresh worker (process restart) with the same database.
    const after = makeSoroban({ pages: [{ events: [ev2], cursor: 'ev-2' }] });
    await makeOracle(after).processRequests();

    const query = after.getEvents.mock.calls[0][0];
    expect(query.cursor).toBe('ev-1');
    expect(query.startLedger).toBeUndefined();
    expect(after.getLatestLedger).not.toHaveBeenCalled();
    expect(invokeCalls(after, 'fulfill_random').map((c) => c.args[1])).toEqual([2n]);
  });

  test('replaying an already revealed request does not fulfil it again', async () => {
    const { commitment } = await storeSeed();
    const event = randomRequestedEvent({
      id: 'ev-1',
      requestId: 3,
      caller: COIN_FLIP_ID,
      commitment,
    });
    await makeOracle(
      makeSoroban({ pages: [{ events: [event], cursor: 'ev-1' }] })
    ).processRequests();

    // Crash before the cursor was saved: the same event is delivered again.
    await db('worker_cursors').del();
    const replay = makeSoroban({ pages: [{ events: [event], cursor: 'ev-1' }] });
    await makeOracle(replay).processRequests();

    expect(invokeCalls(replay, 'fulfill_random')).toHaveLength(0);
    // resolve_bet is retried (and is idempotent on-chain via GameAlreadyResolved).
    expect(invokeCalls(replay, 'resolve_bet')).toHaveLength(1);
  });
});

describe('oracle worker — queue top-up', () => {
  test('commits a new batch when the on-chain queue falls below the threshold', async () => {
    const soroban = makeSoroban({ queueLen: 5 });

    const committed = await makeOracle(soroban).topUpQueue();

    expect(committed).toBe(35); // refills to 2 × ORACLE_MIN_QUEUE
    const calls = invokeCalls(soroban, 'commit_seeds');
    expect(calls).toHaveLength(1);
    expect(calls[0].contractId).toBe(RNG_ID);
    expect(calls[0].args[0]).toBe(ORACLE.publicKey());

    const onChain = calls[0].args[1].map((c) => Buffer.from(c).toString('hex'));
    const rows = await db('oracle_seeds').select('seed', 'commitment', 'status');
    expect(rows).toHaveLength(35);
    expect(onChain.sort()).toEqual(rows.map((r) => r.commitment).sort());
    for (const row of rows) {
      expect(row.status).toBe('committed');
      expect(sha256(Buffer.from(row.seed, 'hex')).toString('hex')).toBe(row.commitment);
    }
  });

  test('does nothing while the queue is at or above the threshold', async () => {
    const soroban = makeSoroban({ queueLen: 20 });

    await expect(makeOracle(soroban).topUpQueue()).resolves.toBe(0);
    expect(soroban.invoke).not.toHaveBeenCalled();
    expect(await db('oracle_seeds').count('* as n').first()).toMatchObject({ n: 0 });
  });
});

describe('oracle worker — configuration', () => {
  test('fails loudly when ORACLE_SECRET_KEY is missing', () => {
    const saved = process.env.ORACLE_SECRET_KEY;
    delete process.env.ORACLE_SECRET_KEY;
    try {
      expect(() =>
        createOracle({
          db,
          soroban: makeSoroban(),
          rngContractId: RNG_ID,
          coinFlipContractId: COIN_FLIP_ID,
        })
      ).toThrow(expect.objectContaining({ code: 'ORACLE_NOT_CONFIGURED' }));
    } finally {
      if (saved !== undefined) process.env.ORACLE_SECRET_KEY = saved;
    }
  });
});
