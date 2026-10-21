/**
 * RNG oracle worker.
 *
 * Keeps the random-generator contract's seed commitment queue topped up,
 * fulfils RandomRequested events with the seed whose sha256 was committed
 * for that request, and then resolves the coin-flip game the request belongs
 * to.
 *
 * Seed lifecycle (oracle_seeds.status):
 *   committed → bound (a RandomRequested event popped this commitment)
 *             → revealed (fulfill_random accepted the seed)
 *
 * A seed that is not yet revealed is a secret: it is never logged, never
 * returned by an API, and never put into an error message.
 */
const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('../utils/logger');
const { createGameRegistry } = require('../config/games');

const CURSOR_NAME = 'oracle';
const RANDOM_REQUESTED_TOPIC = 'random_requested';

// random-generator Error discriminants (contracts/random-generator/src/lib.rs).
const RNG_ERROR_ALREADY_FULFILLED = 7;
// coin-flip Error discriminants (contracts/coin-flip/src/lib.rs).
const COIN_FLIP_ERROR_GAME_ALREADY_RESOLVED = 8;

const DEFAULT_MIN_QUEUE = 20;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const EVENT_PAGE_LIMIT = 100;

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const symbolTopic = (name) => StellarSdk.xdr.ScVal.scvSymbol(name).toXDR('base64');

const u64 = (value) => StellarSdk.nativeToScVal(BigInt(value), { type: 'u64' });

const loadCursor = async (db, name) => {
  const row = await db('worker_cursors').where({ name }).first();
  return row ? row.cursor : null;
};

const saveCursor = async (db, name, cursor) => {
  await db('worker_cursors')
    .insert({ name, cursor, updated_at: db.fn.now() })
    .onConflict('name')
    .merge({ cursor, updated_at: db.fn.now() });
};

/**
 * Decodes a random-generator RandomRequested event.
 * Topics: [random_requested, request_id: u64, caller: Address]
 * Data: { max: u64, commitment: BytesN<32> }
 */
const decodeRandomRequested = (event) => {
  const [nameVal, requestIdVal, callerVal] = event.topic;
  if (StellarSdk.scValToNative(nameVal) !== RANDOM_REQUESTED_TOPIC) {
    return null;
  }
  const data = StellarSdk.scValToNative(event.value);
  return {
    requestId: StellarSdk.scValToNative(requestIdVal).toString(),
    caller: StellarSdk.scValToNative(callerVal),
    commitment: Buffer.from(data.commitment).toString('hex'),
  };
};

/**
 * Builds an error that is safe to log: it carries the RPC/contract error codes
 * but never the original message, which can echo invocation arguments (and so
 * an unrevealed seed) back from simulation diagnostics.
 */
const sanitizedInvokeError = (method, requestId, err) => {
  const safe = new Error(
    `${method} failed for request ${requestId} (code=${err.code || 'UNKNOWN'}, ` +
      `contractError=${err.contractErrorCode ?? 'none'})`
  );
  safe.code = err.code;
  safe.contractErrorCode = err.contractErrorCode;
  return safe;
};

const resolveConfig = (options = {}) => {
  const env = process.env;
  const secret = options.secretKey || env.ORACLE_SECRET_KEY;
  const rngContractId = options.rngContractId || env.RANDOM_GENERATOR_CONTRACT_ID;
  const coinFlipContractId = options.coinFlipContractId || env.COIN_FLIP_CONTRACT_ID;
  const diceRollContractId = options.diceRollContractId || env.DICE_ROLL_CONTRACT_ID;

  const missing = [];
  if (!secret) missing.push('ORACLE_SECRET_KEY');
  if (!rngContractId) missing.push('RANDOM_GENERATOR_CONTRACT_ID');
  if (!coinFlipContractId) missing.push('COIN_FLIP_CONTRACT_ID');
  if (missing.length > 0) {
    const error = new Error(`Oracle worker is not configured: missing ${missing.join(', ')}`);
    error.code = 'ORACLE_NOT_CONFIGURED';
    throw error;
  }

  const minQueue = Number(options.minQueue ?? env.ORACLE_MIN_QUEUE ?? DEFAULT_MIN_QUEUE);
  const startLedger = options.startLedger ?? env.ORACLE_START_LEDGER;

  return {
    keypair: StellarSdk.Keypair.fromSecret(secret),
    rngContractId,
    coinFlipContractId,
    diceRollContractId,
    gameRegistry:
      options.gameRegistry || createGameRegistry({ coinFlipContractId, diceRollContractId }),
    minQueue: Number.isInteger(minQueue) && minQueue > 0 ? minQueue : DEFAULT_MIN_QUEUE,
    startLedger: startLedger ? Number(startLedger) : null,
  };
};

/**
 * Creates the oracle's operations bound to a config and its dependencies.
 * `db` and `soroban` are injectable so the worker can be tested against an
 * in-memory database and a stubbed RPC.
 */
const createOracle = (options = {}) => {
  const config = resolveConfig(options);
  const db = options.db || require('../config/database');
  const soroban = options.soroban || require('./soroban.service');
  const { keypair, rngContractId, gameRegistry, minQueue } = config;
  const oracleAddress = () => new StellarSdk.Address(keypair.publicKey()).toScVal();

  /**
   * Commits a new batch of seeds when the on-chain queue drops below
   * minQueue. Seeds are written to the database before the commit_seeds
   * transaction is sent, so a crash after the transaction lands can never
   * leave an on-chain commitment whose seed is lost. A batch whose
   * transaction failed leaves inert rows: their commitments are not on-chain,
   * so no request can ever bind them.
   *
   * @returns {Promise<number>} number of seeds committed
   */
  const topUpQueue = async () => {
    const queueLen = Number(await soroban.simulate(rngContractId, 'get_commitment_queue_len'));
    if (queueLen >= minQueue) return 0;

    const count = minQueue * 2 - queueLen;
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      const seed = crypto.randomBytes(32);
      rows.push({ seed: seed.toString('hex'), commitment: sha256Hex(seed), status: 'committed' });
    }
    await db('oracle_seeds').insert(rows);

    const commitments = StellarSdk.xdr.ScVal.scvVec(
      rows.map((row) => StellarSdk.xdr.ScVal.scvBytes(Buffer.from(row.commitment, 'hex')))
    );
    const { txHash } = await soroban.invoke(
      rngContractId,
      'commit_seeds',
      [oracleAddress(), commitments],
      keypair
    );
    logger.info('Oracle committed seed batch', { count, queueLenBefore: queueLen, txHash });
    return count;
  };

  const fulfil = async (seedRow, requestId) => {
    try {
      const { txHash } = await soroban.invoke(
        rngContractId,
        'fulfill_random',
        [
          oracleAddress(),
          u64(requestId),
          StellarSdk.xdr.ScVal.scvBytes(Buffer.from(seedRow.seed, 'hex')),
        ],
        keypair
      );
      logger.info('Oracle fulfilled randomness request', { requestId, txHash });
    } catch (err) {
      if (err.contractErrorCode !== RNG_ERROR_ALREADY_FULFILLED) {
        throw sanitizedInvokeError('fulfill_random', requestId, err);
      }
      logger.info('Randomness request was already fulfilled', { requestId });
    }
    await db('oracle_seeds')
      .where({ id: seedRow.id })
      .update({ status: 'revealed', updated_at: db.fn.now() });
  };

  const resolveGame = async (game, gameId) => {
    try {
      const { txHash } = await soroban.invoke(
        game.contractId,
        game.resolveMethod,
        [u64(gameId)],
        keypair
      );
      logger.info('Oracle resolved game', { game: game.name, gameId, txHash });
    } catch (err) {
      if (err.contractErrorCode !== game.alreadyResolvedErrorCode) {
        throw sanitizedInvokeError(game.resolveMethod, gameId, err);
      }
      logger.info('Game was already resolved', { game: game.name, gameId });
    }
  };

  /**
   * Handles one RandomRequested event. Throws on a retryable failure so the
   * caller does not advance the cursor past it.
   */
  const handleRandomRequested = async (event) => {
    const request = decodeRandomRequested(event);
    if (!request) return;
    const { requestId, caller, commitment } = request;

    const seedRow = await db('oracle_seeds').where({ commitment }).first();
    if (!seedRow) {
      // Not ours (or the seed store was lost); nothing this oracle can do.
      logger.error('No stored seed for requested commitment; skipping', { requestId, commitment });
      return;
    }
    if (seedRow.request_id !== null && String(seedRow.request_id) !== requestId) {
      // Never reveal one seed for two requests.
      logger.error('Commitment is already bound to another request; skipping', {
        requestId,
        commitment,
      });
      return;
    }

    if (seedRow.status === 'committed') {
      await db('oracle_seeds')
        .where({ id: seedRow.id })
        .update({ status: 'bound', request_id: requestId, updated_at: db.fn.now() });
    }

    if (seedRow.status !== 'revealed') {
      await fulfil(seedRow, requestId);
    }

    const game = gameRegistry[caller];
    if (!game) {
      logger.warn('Randomness request came from an unregistered game; skipping resolution', {
        caller,
        requestId,
      });
      return;
    }
    await resolveGame(game, requestId);
  };

  /**
   * Polls RandomRequested events from the saved cursor and handles each one,
   * saving the cursor after every handled event so a restart resumes exactly
   * where processing stopped.
   *
   * @returns {Promise<number>} number of events handled
   */
  const processRequests = async () => {
    const cursor = await loadCursor(db, CURSOR_NAME);
    const query = {
      contractIds: [rngContractId],
      topics: [[symbolTopic(RANDOM_REQUESTED_TOPIC), '*', '*']],
      limit: EVENT_PAGE_LIMIT,
    };
    if (cursor) {
      query.cursor = cursor;
    } else {
      query.startLedger = config.startLedger || (await soroban.getLatestLedger());
    }

    const { events, cursor: nextCursor } = await soroban.getEvents(query);
    let handled = 0;
    for (const event of events) {
      if (event.inSuccessfulContractCall !== false) {
        await handleRandomRequested(event);
      }
      await saveCursor(db, CURSOR_NAME, event.id);
      handled += 1;
    }
    if (nextCursor) {
      await saveCursor(db, CURSOR_NAME, nextCursor);
    }
    return handled;
  };

  const runCycle = async () => {
    try {
      await topUpQueue();
    } catch (err) {
      logger.error('Oracle queue top-up failed', { error: err.message, code: err.code });
    }
    try {
      await processRequests();
    } catch (err) {
      logger.error('Oracle request processing failed', { error: err.message, code: err.code });
    }
  };

  return { topUpQueue, processRequests, handleRandomRequested, runCycle, config };
};

/**
 * Starts the oracle polling loop. Cycles never overlap: the next one is
 * scheduled only after the previous one finishes.
 *
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs] - Defaults to ORACLE_POLL_INTERVAL_MS or 5000.
 * @returns {{ stop: () => void }}
 */
const startOracleWorker = (options = {}) => {
  const oracle = createOracle(options);
  const pollIntervalMs =
    Number(options.pollIntervalMs || process.env.ORACLE_POLL_INTERVAL_MS) ||
    DEFAULT_POLL_INTERVAL_MS;

  let stopped = false;
  let timer = null;

  const loop = async () => {
    if (stopped) return;
    await oracle.runCycle();
    if (!stopped) {
      timer = setTimeout(loop, pollIntervalMs);
    }
  };

  logger.info('Starting RNG oracle worker', {
    oracle: oracle.config.keypair.publicKey(),
    rngContractId: oracle.config.rngContractId,
    games: Object.values(oracle.config.gameRegistry).map((game) => game.name),
    minQueue: oracle.config.minQueue,
    pollIntervalMs,
  });
  timer = setTimeout(loop, 0);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};

module.exports = {
  startOracleWorker,
  createOracle,
  decodeRandomRequested,
  RNG_ERROR_ALREADY_FULFILLED,
  COIN_FLIP_ERROR_GAME_ALREADY_RESOLVED,
};
