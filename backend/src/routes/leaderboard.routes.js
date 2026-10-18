const express = require('express');
const { getLeaderboard } = require('../controllers/games.controller');
const { rateLimit } = require('../middleware/rate-limit.middleware');

const router = express.Router();

const routeDocs = [
  {
    method: 'get',
    path: '/',
    operationId: 'getLeaderboard',
    summary:
      'Rank players by net winnings (payout - bet_amount) from resolved on-chain games, optionally scoped to one game type',
    tags: ['Leaderboard'],
    parameters: [
      {
        name: 'game',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Optional game_type filter (e.g. coin-flip).',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        description: 'Maximum number of entries returned (max 100).',
      },
    ],
    responses: {
      200: {
        description: 'Leaderboard entries returned successfully',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                required: ['rank', 'playerAddress', 'score', 'gamesPlayed'],
                properties: {
                  rank: { type: 'integer' },
                  playerAddress: { type: 'string' },
                  score: { type: 'string' },
                  gamesPlayed: { type: 'integer' },
                },
              },
            },
          },
        },
      },
      500: {
        description: 'Unexpected server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
    },
  },
];

router.get('/', rateLimit('games'), getLeaderboard);

module.exports = router;
module.exports.routeDocs = routeDocs;
