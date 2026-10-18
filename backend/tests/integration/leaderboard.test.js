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

const router = require('../../src/routes/leaderboard.routes');
const GameModel = require('../../src/models/Game.model');

jest.mock('../../src/models/Game.model');

const app = express();
app.use(express.json());
app.use('/leaderboard', router);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { message: err.message, code: err.code } });
});

describe('GET /leaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ranks players by net winnings with gamesPlayed, not fabricated scores', async () => {
    GameModel.getLeaderboard.mockResolvedValue([
      { playerAddress: 'GALICE...', score: '40.5', gamesPlayed: 12 },
      { playerAddress: 'GBOB...', score: '-10', gamesPlayed: 5 },
    ]);

    const res = await request(app).get('/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { rank: 1, playerAddress: 'GALICE...', score: '40.5', gamesPlayed: 12 },
      { rank: 2, playerAddress: 'GBOB...', score: '-10', gamesPlayed: 5 },
    ]);
  });

  test('defaults to a limit of 10 when none is given', async () => {
    GameModel.getLeaderboard.mockResolvedValue([]);

    await request(app).get('/leaderboard');

    expect(GameModel.getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  test('caps the limit at 100', async () => {
    GameModel.getLeaderboard.mockResolvedValue([]);

    await request(app).get('/leaderboard').query({ limit: 500 });

    expect(GameModel.getLeaderboard).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  test('passes the game query param through as a game-type filter', async () => {
    GameModel.getLeaderboard.mockResolvedValue([]);

    await request(app).get('/leaderboard').query({ game: 'coin-flip', limit: 5 });

    expect(GameModel.getLeaderboard).toHaveBeenCalledWith(
      expect.objectContaining({ gameType: 'coin-flip', limit: 5 })
    );
  });

  test('returns an empty array, not fabricated entries, when nobody has played yet', async () => {
    GameModel.getLeaderboard.mockResolvedValue([]);

    const res = await request(app).get('/leaderboard');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns score as a decimal string, not a float', async () => {
    GameModel.getLeaderboard.mockResolvedValue([
      { playerAddress: 'GALICE...', score: '15.5', gamesPlayed: 3 },
    ]);

    const res = await request(app).get('/leaderboard');

    expect(res.status).toBe(200);
    expect(typeof res.body[0].score).toBe('string');
    expect(res.body[0].score).toBe('15.5');
  });
});
