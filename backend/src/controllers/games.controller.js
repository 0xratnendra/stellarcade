/**
 * Controller for managing all game-related API requests.
 */
const gameService = require('../services/game.service');

const getGames = async (req, res, next) => {
  try {
    const result = await gameService.listGames();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getRecentGames = async (req, res, next) => {
  try {
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const rawCursor = req.query.cursor;

    const parsedPage = rawPage === undefined ? 1 : parseInt(rawPage, 10);
    const parsedLimit = rawLimit === undefined ? 10 : parseInt(rawLimit, 10);
    const cursor = rawCursor === undefined ? undefined : parseInt(rawCursor, 10);

    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : parsedLimit;

    if (cursor !== undefined && (Number.isNaN(cursor) || cursor < 1)) {
      const error = new Error('Query parameter "cursor" must be a positive integer.');
      error.statusCode = 400;
      error.code = 'INVALID_QUERY_PARAM';
      throw error;
    }

    const { player, gameType, status, sortBy, sortDir } = req.query;

    if (player !== undefined) {
      if (typeof player !== 'string' || !/^[G][A-Z2-7]{55}$/.test(player)) {
        const error = new Error('Query parameter "player" must be a valid Stellar address.');
        error.statusCode = 400;
        error.code = 'INVALID_PLAYER_ADDRESS';
        throw error;
      }
    }

    const result = await gameService.getRecentGames({
      page,
      limit,
      cursor: cursor === undefined ? undefined : String(cursor),
      player,
      gameType,
      status,
      sortBy,
      sortDir,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const CONTRACT_ID_PATTERN = /^[C][A-Z2-7]{55}$/;
const GAME_ID_PATTERN = /^\d{1,20}$/;
const U64_MAX = 18446744073709551615n;

const getIndexedGame = async (req, res, next) => {
  try {
    const { contractId, id } = req.params;

    if (!CONTRACT_ID_PATTERN.test(contractId)) {
      const error = new Error(
        'Path parameter "contractId" must be a Stellar contract id (56 characters, C...).'
      );
      error.statusCode = 400;
      error.code = 'INVALID_CONTRACT_ID';
      throw error;
    }

    if (!GAME_ID_PATTERN.test(id) || BigInt(id) > U64_MAX) {
      const error = new Error('Path parameter "id" must be an on-chain game id (u64, decimal).');
      error.statusCode = 400;
      error.code = 'INVALID_GAME_ID';
      throw error;
    }

    // Normalise leading zeros so "007" and "7" address the same chain game.
    const game = await gameService.getIndexedGame({ contractId, id: String(BigInt(id)) });
    res.status(200).json(game);
  } catch (error) {
    next(error);
  }
};

const getLeaderboard = async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;
    const parsedLimit = rawLimit === undefined ? 10 : parseInt(rawLimit, 10);
    let limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : parsedLimit;
    limit = Math.min(limit, 100);

    const result = await gameService.getLeaderboard({
      gameType: req.query.game,
      limit,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getGames,
  getRecentGames,
  getIndexedGame,
  getLeaderboard,
};
