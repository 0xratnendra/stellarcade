const express = require('express');
const { getGames, getRecentGames, getIndexedGame } = require('../controllers/games.controller');
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
  {
    method: 'get',
    path: '/:contractId/:id',
    operationId: 'getIndexedGame',
    summary: 'Fetch one indexed on-chain game by contract id and on-chain game id',
    tags: ['Games'],
    description:
      'Reads the row the event indexer wrote for a single round. 404 GAME_NOT_FOUND means the ' +
      'round is not indexed yet (or the ids are wrong), which is distinct from the backend being ' +
      'unavailable.',
    parameters: [
      {
        name: 'contractId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Coin-flip contract id (Stellar contract address, C...).',
      },
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'On-chain game id as a decimal u64 string.',
      },
    ],
    responses: {
      200: {
        description: 'Indexed game returned successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/IndexedGameResponse' },
          },
        },
      },
      400: {
        description: 'Invalid contract id or game id',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
          },
        },
      },
      404: {
        description: 'No game indexed for this contract id and game id',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
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
router.get('/:contractId/:id', rateLimit('games'), getIndexedGame);

module.exports = router;
module.exports.routeDocs = routeDocs;
