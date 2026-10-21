const GameModel = require('../models/Game.model');

/**
 * Service for managing game-related business logic.
 */
const gameService = {
  /**
   * Lists games for the public catalog.
   *
   * @returns {Promise<{ games: Array }>}
   */
  listGames: async () => {
    return {
      games: [
        {
          id: 'coinflip-duel',
          name: 'Coinflip Duel',
          status: 'active',
          wager: 5,
          description:
            'Instant 50/50 provably fair on-chain duel. Double your stake on heads or tails.',
          contract: 'coin-flip',
          players: 142,
          category: 'PVP / Duel',
        },
        {
          id: 'rng-dice',
          name: 'Verifiable Dice Roll',
          status: 'active',
          wager: 10,
          description:
            'Multi-sided dice arena backed by cryptographic seed commitments and Soroban RNG.',
          contract: 'random-generator',
          players: 89,
          category: 'Table / RNG',
        },
        {
          id: 'prizepool-gauntlet',
          name: 'Prize Pool Gauntlet',
          status: 'active',
          wager: 25,
          description:
            'High-roller reserve pool with accumulated yields and on-chain payout splits.',
          contract: 'prize-pool',
          players: 37,
          category: 'Jackpot / Pool',
        },
        {
          id: 'rock-paper-scissors',
          name: 'Rock Paper Scissors',
          status: 'active',
          wager: 10,
          description:
            'Commit-reveal PvP hand battle with cryptographic dispute resolution on Soroban.',
          contract: 'rock-paper-scissors',
          players: 64,
          category: 'PVP / Duel',
        },
        {
          id: 'minesweeper-escrow',
          name: 'Minesweeper Escrow',
          status: 'active',
          wager: 15,
          description:
            'Minefield tile clearance with multi-signature stake escrow and cash-out checkpoints.',
          contract: 'minesweeper-escrow',
          players: 48,
          category: 'Strategy / Escrow',
        },
      ],
    };
  },

  /**
   * Fetches recent games with pagination metadata.
   *
   * @param {Object} params - Query parameters
   * @returns {Promise<{items: Array, page: number, pageSize: number, total: number, totalPages: number}>}
   */
  getRecentGames: async (params) => {
    const requestedPage = Math.max(Number(params.page) || 1, 1);
    const cursorPage = Math.max(Number(params.cursor) || requestedPage, 1);
    const effectiveParams = {
      ...params,
      page: cursorPage,
    };

    const { items, total, page, pageSize } = await GameModel.findRecent(effectiveParams);
    const totalPages = Math.ceil(total / pageSize) || 0;
    const nextPage = page < totalPages ? page + 1 : null;
    const nextCursor = nextPage ? String(nextPage) : null;
    const hasNextPage = nextPage !== null;

    return {
      items,
      page,
      pageSize,
      total,
      totalPages,
      pagination: {
        nextCursor,
        hasNextPage,
      },
    };
  },

  /**
   * Fetches one indexed on-chain game by contract id and on-chain game id.
   *
   * @param {Object} params
   * @param {string} params.contractId - Stellar contract id (C...)
   * @param {string} params.id - On-chain u64 game id as a decimal string
   * @returns {Promise<Object>} the games row as stored by the indexer
   * @throws {Error} statusCode 404, code GAME_NOT_FOUND when the round is not
   *   indexed (yet) — callers use this to tell "not indexed" from "backend
   *   unavailable".
   */
  getIndexedGame: async ({ contractId, id }) => {
    const game = await GameModel.findByChainGame(contractId, id);
    if (!game) {
      const error = new Error('No indexed game matches this contract and game id.');
      error.statusCode = 404;
      error.code = 'GAME_NOT_FOUND';
      throw error;
    }
    return game;
  },

  /**
   * Ranks players by total payout (winnings), optionally scoped to one game type.
   *
   * @param {Object} params
   * @param {string} [params.gameType]
   * @param {number} [params.limit=10]
   * @returns {Promise<Array<{rank: number, playerAddress: string, score: string}>>}
   */
  getLeaderboard: async ({ gameType, limit = 10 } = {}) => {
    const rows = await GameModel.getLeaderboard({ gameType, limit });
    return rows.map((row, index) => ({
      rank: index + 1,
      playerAddress: row.playerAddress,
      score: String(row.score || 0),
      gamesPlayed: row.gamesPlayed,
    }));
  },
};

module.exports = gameService;
