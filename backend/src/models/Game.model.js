/**
 * Base model for Game results.
 */
const db = require('../config/database');
const logger = require('../utils/logger');

const GameModel = {
  /**
   * Creates a game row and returns the inserted record.
   *
   * @param {Object} gameData
   * @returns {Promise<Object|null>}
   */
  async create(gameData) {
    try {
      const rows = await db('games').insert(gameData).returning('*');
      return rows[0] || null;
    } catch (error) {
      logger.error('Error in GameModel.create:', error);
      throw error;
    }
  },

  /**
   * Finds a single game by id.
   *
   * @param {number|string} gameId
   * @returns {Promise<Object|null>}
   */
  async findById(gameId) {
    try {
      const game = await db('games').where({ id: gameId }).first();
      return game || null;
    } catch (error) {
      logger.error('Error in GameModel.findById:', error);
      throw error;
    }
  },

  /**
   * Lists games for a given user with pagination metadata.
   *
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number} [params.page=1]
   * @param {number} [params.limit=10]
   * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
   */
  async listByUser({ userId, page = 1, limit = 10 }) {
    try {
      const safePage = Math.max(Number(page) || 1, 1);
      const safeLimit = Math.max(Number(limit) || 10, 1);
      const offset = (safePage - 1) * safeLimit;

      const query = db('games').where({ user_id: userId });
      const countQuery = query.clone().count('* as total').first();

      const itemsQuery = query
        .clone()
        .orderBy('created_at', 'desc')
        .limit(safeLimit)
        .offset(offset);

      const [items, countRow] = await Promise.all([itemsQuery, countQuery]);
      const total = Number(countRow?.total || 0);

      return { items, total, page: safePage, pageSize: safeLimit };
    } catch (error) {
      logger.error('Error in GameModel.listByUser:', error);
      throw error;
    }
  },

  /**
   * Finds recent games with pagination, filtering, and sorting.
   *
   * @param {Object} params - Query parameters
   * @param {number} params.page - Page number
   * @param {number} params.limit - Items per page
   * @param {string} [params.player] - Filter by player address (on-chain player_address or users.wallet_address)
   * @param {string} [params.gameType] - Filter by game type
   * @param {string} [params.status] - Filter by game result (mapped from status)
   * @param {string} [params.sortBy] - Column to sort by
   * @param {string} [params.sortDir] - Sort direction (asc/desc)
   * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
   */
  async findRecent({ page = 1, limit = 10, player, gameType, status, sortBy, sortDir }) {
    try {
      const safePage = Math.max(Number(page) || 1, 1);
      const safeLimit = Math.max(Number(limit) || 10, 1);
      const offset = (safePage - 1) * safeLimit;

      const allowedSortColumns = ['created_at', 'bet_amount', 'result', 'game_type'];
      const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';
      const safeSortDir = String(sortDir).toLowerCase() === 'asc' ? 'asc' : 'desc';

      // Left join: indexed on-chain games from wallets without an account
      // have no user row, and fall back to the on-chain player address.
      const query = db('games')
        .select(
          'games.*',
          db.raw('COALESCE(users.wallet_address, games.player_address) as user_wallet')
        )
        .leftJoin('users', 'games.user_id', 'users.id');

      if (player) {
        query.where(function () {
          this.where('games.player_address', player).orWhere('users.wallet_address', player);
        });
      }

      if (gameType) {
        query.where('game_type', gameType);
      }

      if (status) {
        query.where('result', status);
      }

      const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();

      query.orderBy(safeSortBy, safeSortDir).limit(safeLimit).offset(offset);

      const [items, countRow] = await Promise.all([query, countQuery]);
      const total = Number(countRow?.total || 0);

      return { items, total, page: safePage, pageSize: safeLimit };
    } catch (error) {
      logger.error('Error in GameModel.findRecent:', error);
      throw error;
    }
  },

  /**
   * Ranks players by net winnings (payout - bet_amount) from resolved on-chain games.
   * Off-chain simulated rows and unresolved games never affect the result.
   *
   * @param {Object} params
   * @param {string} [params.gameType] - Filter by game type
   * @param {number} [params.limit=10]
   * @returns {Promise<Array<{playerAddress: string, score: string, gamesPlayed: number}>>}
   */
  async getLeaderboard({ gameType, limit = 10 } = {}) {
    try {
      const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);

      // Net score computed in a subquery so ORDER BY can reference it.
      const subquery = db('games')
        .where('status', 'resolved')
        .whereNotNull('chain_game_id')
        .select(
          'player_address',
          db.raw('SUM(payout) - SUM(bet_amount) as net_score'),
          db.raw('SUM(payout) as total_payout'),
          db.raw('SUM(bet_amount) as total_bet'),
          db.raw('COUNT(*) as games_played')
        )
        .groupBy('player_address');

      if (gameType) {
        subquery.where('game_type', gameType);
      }

      const rows = await db
        .from(subquery.as('scores'))
        .select('player_address', 'net_score', 'total_payout', 'total_bet', 'games_played')
        .orderBy('net_score', 'desc')
        .limit(safeLimit);

      return rows.map((row) => ({
        playerAddress: row.player_address,
        score: String(row.net_score),
        gamesPlayed: Number(row.games_played),
      }));
    } catch (error) {
      logger.error('Error in GameModel.getLeaderboard:', error);
      throw error;
    }
  },

  /**
   * Finds an indexed on-chain game by its contract and on-chain game id.
   *
   * @param {string} contractId
   * @param {string} chainGameId - u64 as a decimal string
   * @returns {Promise<Object|null>}
   */
  async findByChainGame(contractId, chainGameId) {
    try {
      const game = await db('games')
        .where({ contract_id: contractId, chain_game_id: chainGameId })
        .first();
      return game || null;
    } catch (error) {
      logger.error('Error in GameModel.findByChainGame:', error);
      throw error;
    }
  },

  /**
   * Inserts an indexed on-chain game unless (contract_id, chain_game_id)
   * already exists, so replaying the same BetPlaced event changes nothing.
   *
   * @param {Object} gameData - Must include contract_id and chain_game_id
   * @returns {Promise<boolean>} true if a row was inserted
   */
  async insertChainGame(gameData) {
    try {
      const existing = await this.findByChainGame(gameData.contract_id, gameData.chain_game_id);
      if (existing) return false;
      await db('games').insert(gameData).onConflict(['contract_id', 'chain_game_id']).ignore();
      return true;
    } catch (error) {
      logger.error('Error in GameModel.insertChainGame:', error);
      throw error;
    }
  },

  /**
   * Moves a pending indexed game to resolved. Only a pending row is updated,
   * so the transition happens once no matter how often the event is replayed.
   *
   * @param {string} contractId
   * @param {string} chainGameId
   * @param {Object} patch - result, payout, resolve_tx_hash, resolved_at, user_id
   * @returns {Promise<Object|null>} the resolved row, or null if no pending row existed
   */
  async resolveChainGame(contractId, chainGameId, patch) {
    try {
      const updated = await db('games')
        .where({ contract_id: contractId, chain_game_id: chainGameId, status: 'pending' })
        .update({ ...patch, status: 'resolved' });
      if (!updated) return null;
      return await this.findByChainGame(contractId, chainGameId);
    } catch (error) {
      logger.error('Error in GameModel.resolveChainGame:', error);
      throw error;
    }
  },

  /**
   * Updates a game row and returns updated record.
   *
   * @param {number|string} gameId
   * @param {Object} patch
   * @returns {Promise<Object|null>}
   */
  async update(gameId, patch) {
    try {
      const rows = await db('games').where({ id: gameId }).update(patch).returning('*');
      return rows[0] || null;
    } catch (error) {
      logger.error('Error in GameModel.update:', error);
      throw error;
    }
  },
};

module.exports = GameModel;
