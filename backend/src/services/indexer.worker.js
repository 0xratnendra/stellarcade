const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('../utils/logger');

const CURSOR_NAME = 'indexer';
const BET_PLACED_TOPIC = 'bet_placed';
const BET_RESOLVED_TOPIC = 'bet_resolved';
const GAME_TYPE = 'coin-flip';
const SIDES = ['heads', 'tails'];
// Stellar asset contracts use 7 decimals: 1 unit = 10^7 stroops.
const STROOP_DECIMALS = 7;

const DEFAULT_POLL_INTERVAL_MS = 5000;
const EVENT_PAGE_LIMIT = 100;

const symbolTopic = (name) => StellarSdk.xdr.ScVal.scvSymbol(name).toXDR('base64');

/**
 * Converts an integer stroop amount to an exact decimal string in token units
 * (e.g. 25000000n → "2.5000000"). No floating point is involved.
 *
 * @param {bigint|number|string} stroops
 * @returns {string}
 */
const stroopsToUnits = (stroops) => {
  const value = BigInt(stroops);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(STROOP_DECIMALS + 1, '0');
  const whole = digits.slice(0, -STROOP_DECIMALS);
  const fraction = digits.slice(-STROOP_DECIMALS);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

const normalizeTxHash = (hash) => {
  const normalized = String(hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    const error = new Error(`Event carries an invalid transaction hash: ${hash}`);
    error.code = 'INVALID_TX_HASH';
    throw error;
  }
  return normalized;
};

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
 * Decodes a coin-flip BetPlaced / BetResolved event.
 * Topics: [bet_placed | bet_resolved, game_id: u64, player: Address]
 * Data: BetPlaced { side: u32, wager: i128 }, BetResolved { won: bool, payout: i128 }
 */
const decodeCoinFlipEvent = (event) => {
  const [nameVal, gameIdVal, playerVal] = event.topic;
  const name = StellarSdk.scValToNative(nameVal);
  if (name !== BET_PLACED_TOPIC && name !== BET_RESOLVED_TOPIC) {
    return null;
  }
  return {
    name,
    gameId: StellarSdk.scValToNative(gameIdVal).toString(),
    player: StellarSdk.scValToNative(playerVal),
    data: StellarSdk.scValToNative(event.value),
  };
};

const resolveConfig = (options = {}) => {
  const contractId = options.contractId || process.env.COIN_FLIP_CONTRACT_ID;
  if (!contractId) {
    const error = new Error('Indexer worker is not configured: missing COIN_FLIP_CONTRACT_ID');
    error.code = 'INDEXER_NOT_CONFIGURED';
    throw error;
  }
  const startLedger = options.startLedger ?? process.env.INDEXER_START_LEDGER;
  return { contractId, startLedger: startLedger ? Number(startLedger) : null };
};

/**
 * Creates the indexer's operations. `db`, `soroban`, `GameModel`, `UserModel`
 * and `QuestModel` are injectable for tests; they default to the real modules.
 */
const createIndexer = (options = {}) => {
  const config = resolveConfig(options);
  const db = options.db || require('../config/database');
  const soroban = options.soroban || require('./soroban.service');
  const GameModel = options.GameModel || require('../models/Game.model');
  const UserModel = options.UserModel || require('../models/User.model');
  const QuestModel = options.QuestModel || require('../models/Quest.model');
  const { contractId } = config;

  const findUserId = async (walletAddress) => {
    const user = await UserModel.findByWallet(walletAddress);
    return user ? user.id : null;
  };

  const placedRow = ({ gameId, player, side, wager, userId, txHash, ledger, closedAt }) => ({
    contract_id: contractId,
    chain_game_id: gameId,
    player_address: player,
    user_id: userId,
    game_type: GAME_TYPE,
    side: SIDES[Number(side)] || null,
    bet_amount: stroopsToUnits(wager),
    payout: '0.0000000',
    result: 'pending',
    status: 'pending',
    tx_hash: txHash,
    ledger,
    ...(closedAt ? { created_at: new Date(closedAt) } : {}),
  });

  const handleBetPlaced = async (event, decoded) => {
    await GameModel.insertChainGame(
      placedRow({
        gameId: decoded.gameId,
        player: decoded.player,
        side: decoded.data.side,
        wager: decoded.data.wager,
        userId: await findUserId(decoded.player),
        txHash: normalizeTxHash(event.txHash),
        ledger: event.ledger,
        closedAt: event.ledgerClosedAt,
      })
    );
  };

  /**
   * Records quest progress for a game that just moved to resolved. Runs only
   * on that transition, so replays never count a game twice. Best-effort: a
   * quest failure must not stop indexing.
   */
  const recordQuestProgress = async (game) => {
    if (!game.user_id) return;
    try {
      await QuestModel.recordProgress(game.user_id, 'play-5-games', 1);
      if (game.result === 'win') {
        await QuestModel.recordProgress(game.user_id, 'win-3-games', 1);
      }
    } catch (err) {
      logger.error('Failed to record quest progress for indexed game', {
        gameId: game.chain_game_id,
        error: err.message,
      });
    }
  };

  const handleBetResolved = async (event, decoded) => {
    const { gameId, player, data } = decoded;
    let existing = await GameModel.findByChainGame(contractId, gameId);

    if (!existing) {
      // BetPlaced predates the indexer's start ledger: read the bet from the
      // contract instead of guessing. The placing transaction is unknown, so
      // tx_hash stays null.
      const game = await soroban.simulate(contractId, 'get_game', [
        StellarSdk.nativeToScVal(BigInt(gameId), { type: 'u64' }),
      ]);
      await GameModel.insertChainGame(
        placedRow({
          gameId,
          player,
          side: game.side,
          wager: game.wager,
          userId: await findUserId(player),
          txHash: null,
          ledger: null,
          closedAt: null,
        })
      );
      existing = await GameModel.findByChainGame(contractId, gameId);
    }

    const patch = {
      result: data.won ? 'win' : 'loss',
      payout: stroopsToUnits(data.payout),
      resolve_tx_hash: normalizeTxHash(event.txHash),
      resolved_at: event.ledgerClosedAt ? new Date(event.ledgerClosedAt) : new Date(),
    };
    if (!existing.user_id) {
      // The player may have created an account after placing the bet.
      const userId = await findUserId(player);
      if (userId) patch.user_id = userId;
    }

    const resolved = await GameModel.resolveChainGame(contractId, gameId, patch);
    if (resolved) {
      await recordQuestProgress(resolved);
    }
  };

  const handleEvent = async (event) => {
    if (event.inSuccessfulContractCall === false) return;
    const decoded = decodeCoinFlipEvent(event);
    if (!decoded) return;
    if (decoded.name === BET_PLACED_TOPIC) {
      await handleBetPlaced(event, decoded);
    } else {
      await handleBetResolved(event, decoded);
    }
  };

  /**
   * Polls events from the saved cursor and indexes them, saving the cursor
   * after every event so a restart resumes where processing stopped.
   *
   * @returns {Promise<number>} number of events handled
   */
  const processEvents = async () => {
    const cursor = await loadCursor(db, CURSOR_NAME);
    const query = {
      contractIds: [contractId],
      topics: [
        [symbolTopic(BET_PLACED_TOPIC), '*', '*'],
        [symbolTopic(BET_RESOLVED_TOPIC), '*', '*'],
      ],
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
      await handleEvent(event);
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
      await processEvents();
    } catch (err) {
      logger.error('Indexer event processing failed', { error: err.message, code: err.code });
    }
  };

  return { processEvents, handleEvent, runCycle, config };
};

/**
 * Starts the indexer polling loop. Cycles never overlap.
 *
 * @param {object} [options]
 * @param {number} [options.pollIntervalMs] - Defaults to INDEXER_POLL_INTERVAL_MS or 5000.
 * @returns {{ stop: () => void }}
 */
const startIndexerWorker = (options = {}) => {
  const indexer = createIndexer(options);
  const pollIntervalMs =
    Number(options.pollIntervalMs || process.env.INDEXER_POLL_INTERVAL_MS) ||
    DEFAULT_POLL_INTERVAL_MS;

  let stopped = false;
  let timer = null;

  const loop = async () => {
    if (stopped) return;
    await indexer.runCycle();
    if (!stopped) {
      timer = setTimeout(loop, pollIntervalMs);
    }
  };

  logger.info('Starting coin-flip indexer worker', {
    contractId: indexer.config.contractId,
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
  startIndexerWorker,
  createIndexer,
  decodeCoinFlipEvent,
  stroopsToUnits,
};
