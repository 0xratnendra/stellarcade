/**
 * Ensures the games stack resolves at require-time (no missing modules, valid graph).
 */
jest.mock('../../src/config/database', () => {
  const mock = jest.fn();
  mock.raw = jest.fn().mockResolvedValue({});
  return mock;
});

jest.mock('../../src/config/redis', () => ({
  client: {
    get: jest.fn(),
    setEx: jest.fn(),
    on: jest.fn(),
  },
  connectPromise: Promise.resolve(),
}));

jest.mock('../../src/models/Game.model', () => ({
  findRecent: jest.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
}));

describe('Games module graph', () => {
  test('game.service loads and exposes expected API', () => {
    const gameService = require('../../src/services/game.service');

    expect(typeof gameService.listGames).toBe('function');
    expect(typeof gameService.getRecentGames).toBe('function');
    expect(gameService.playSimpleGame).toBeUndefined();
  });

  test('games.controller loads after service', () => {
    const controller = require('../../src/controllers/games.controller');

    expect(typeof controller.getGames).toBe('function');
    expect(typeof controller.getRecentGames).toBe('function');
    expect(controller.playSimpleGame).toBeUndefined();
  });

  test('games.routes loads (controller, rate-limit subgraph)', () => {
    jest.isolateModules(() => {
      expect(() => {
        require('../../src/routes/games.routes');
      }).not.toThrow();
    });
  });
});
