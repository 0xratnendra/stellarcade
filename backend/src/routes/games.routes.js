const express = require('express');
const { getGames, getRecentGames } = require('../controllers/games.controller');
const { rateLimit } = require('../middleware/rate-limit.middleware');

const router = express.Router();

const routeDocs = [
  {
    method: 'get',
    path: '/',
    operationId: 'listGames',
    summary: 'List available games',
    tags: ['Games'],
    responses: {
      200: {
        description: 'Available games returned successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GamesCatalogResponse' },
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
  {
    method: 'get',
    path: '/recent',
    operationId: 'listRecentGames',
    summary: 'List recent games with pagination and filters',
    tags: ['Games'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 },
        description: 'Page number to retrieve',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 10 },
        description: 'Number of games to return per page',
      },
      {
        name: 'player',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Filter recent games by player address (Stellar G... address).',
      },
      {
        name: 'gameType',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Filter recent games by game type',
      },
      {
        name: 'status',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Filter recent games by result status',
      },
      {
        name: 'sortBy',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Field used for sorting',
      },
      {
        name: 'sortDir',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['asc', 'desc'] },
        description: 'Sort direction',
      },
    ],
    responses: {
      200: {
        description: 'Recent games returned successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RecentGamesResponse' },
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

router.get('/', rateLimit('games'), getGames);
router.get('/recent', rateLimit('games'), getRecentGames);

module.exports = router;
module.exports.routeDocs = routeDocs;
