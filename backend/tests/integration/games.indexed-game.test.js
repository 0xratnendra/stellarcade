const request = require('supertest');
const express = require('express');

jest.mock('../../src/config/database', () => {
  const mock = jest.fn();
  mock.raw = jest.fn().mockResolvedValue({});
  return mock;
});

jest.mock('../../src/config/redis', () => {
  const mockClient = {
    get: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue('OK'),
    ttl: jest.fn().mockResolvedValue(60),
    setEx: jest.fn().mockResolvedValue('OK'),
    connect: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    isOpen: true,
  };
  return { client: mockClient, connectPromise: Promise.resolve() };
});

jest.mock('../../src/models/Game.model');

const router = require('../../src/routes/games.routes');
const GameModel = require('../../src/models/Game.model');

const app = express();
app.use(express.json());
app.use('/games', router);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { message: err.message, code: err.code } });
});

const CONTRACT_ID = 'CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ';
const indexedRow = {
  id: 12,
  user_id: null,
  game_type: 'coinflip',
  bet_amount: '10.0000000',
  payout: '0.0000000',
  result: 'pending',
  status: 'pending',
  contract_id: CONTRACT_ID,
  chain_game_id: '424242',
  player_address: 'GALICEEXAMPLEADDRESS234567890123456789012345678901234567',
  side: 'heads',
  ledger: 123456,
  tx_hash: 'a'.repeat(64),
  resolve_tx_hash: null,
  resolved_at: null,
  created_at: '2026-10-21T00:00:00.000Z',
};

describe('GET /games/:contractId/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns the indexed row for the contract and on-chain game id', async () => {
    GameModel.findByChainGame.mockResolvedValue(indexedRow);

    const res = await request(app).get(`/games/${CONTRACT_ID}/424242`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(indexedRow);
    expect(GameModel.findByChainGame).toHaveBeenCalledWith(CONTRACT_ID, '424242');
  });

  test('normalises leading zeros so every spelling addresses one chain game', async () => {
    GameModel.findByChainGame.mockResolvedValue(indexedRow);

    await request(app).get(`/games/${CONTRACT_ID}/007`);

    expect(GameModel.findByChainGame).toHaveBeenCalledWith(CONTRACT_ID, '7');
  });

  test('answers 404 GAME_NOT_FOUND when the round is not indexed', async () => {
    GameModel.findByChainGame.mockResolvedValue(null);

    const res = await request(app).get(`/games/${CONTRACT_ID}/999999`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GAME_NOT_FOUND');
    expect(res.body.error.message).toMatch(/not indexed|No indexed game/);
  });

  test('rejects a contract id that is not a Stellar address with 400', async () => {
    const res = await request(app).get('/games/not-a-contract/1');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CONTRACT_ID');
    expect(GameModel.findByChainGame).not.toHaveBeenCalled();
  });

  test.each([['abc'], ['18446744073709551616'], ['-1'], ['12a']])(
    'rejects game id %s with 400 INVALID_GAME_ID',
    async (gameId) => {
      const res = await request(app).get(`/games/${CONTRACT_ID}/${gameId}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_GAME_ID');
      expect(GameModel.findByChainGame).not.toHaveBeenCalled();
    }
  );
});
