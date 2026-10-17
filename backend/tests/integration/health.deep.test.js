const request = require('supertest');
const express = require('express');

// Mock database
jest.mock('../../src/config/database', () => {
  const mock = jest.fn();
  mock.raw = jest.fn().mockResolvedValue({});
  return mock;
});

// Mock redis
jest.mock('../../src/config/redis', () => {
  const mockClient = {
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    setEx: jest.fn().mockResolvedValue('OK'),
    connect: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    isOpen: true,
  };
  return { client: mockClient, connectPromise: Promise.resolve() };
});

// Mock stellar
jest.mock('../../src/config/stellar', () => ({
  server: {
    root: jest.fn().mockResolvedValue({}),
  },
  rpc: {
    getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    getLatestLedger: jest.fn().mockResolvedValue({ id: '12345', sequence: 100 }),
  },
  network: 'testnet',
  passphrase: 'Test SDF Network ; September 2015',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  getContractClient: jest.fn(),
}));

// Mock soroban service
jest.mock('../../src/services/soroban.service', () => ({
  simulate: jest.fn().mockResolvedValue({}),
}));

// Mock logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const db = require('../../src/config/database');
const { client: redisClient } = require('../../src/config/redis');
const { server: horizonServer, rpc: sorobanRpc } = require('../../src/config/stellar');
const sorobanService = require('../../src/services/soroban.service');
const { getDeepHealth } = require('../../src/controllers/health.controller');
const healthService = require('../../src/services/health.service');

// Create a standalone app for testing
const app = express();
app.use(express.json());
app.get('/api/health/deep', getDeepHealth);

const delayResolve = (ms, value) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

describe('GET /api/health/deep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COIN_FLIP_CONTRACT_ID;
    delete process.env.RANDOM_GENERATOR_CONTRACT_ID;
    delete process.env.RNG_CONTRACT_ID;
    db.raw.mockResolvedValue({});
    redisClient.ping.mockResolvedValue('PONG');
    horizonServer.root.mockResolvedValue({});
    sorobanRpc.getHealth.mockResolvedValue({ status: 'healthy' });
    sorobanRpc.getLatestLedger.mockResolvedValue({ id: '12345', sequence: 100 });
    sorobanService.simulate.mockResolvedValue({});
  });

  describe('all-up scenario', () => {
    test('returns healthy status when all dependencies are up', async () => {
      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.dependencies.db.status).toBe('healthy');
      expect(res.body.dependencies.redis.status).toBe('healthy');
      expect(res.body.dependencies.stellar.status).toBe('healthy');
      expect(res.body.soroban.status).toBe('healthy');
      expect(typeof res.body.soroban.latencyMs).toBe('number');
      expect(res.body.contracts).toEqual({
        coinFlip: { status: 'not_configured' },
        randomGenerator: { status: 'not_configured' },
      });
      expect(res.body.dependencies.db.timeout_ms).toBe(5000);
      expect(res.body.dependencies.redis.timeout_ms).toBe(5000);
      expect(res.body.dependencies.stellar.timeout_ms).toBe(5000);
      expect(res.body.dependencies.db.timed_out).toBe(false);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    test('reports dependency latencies when downstream checks are healthy', async () => {
      db.raw.mockImplementation(() => delayResolve(20, {}));
      redisClient.ping.mockImplementation(() => delayResolve(35, 'PONG'));
      horizonServer.root.mockImplementation(() => delayResolve(50, {}));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(200);
      expect(res.body.dependencies.db.latency_ms).toBeGreaterThanOrEqual(15);
      expect(res.body.dependencies.redis.latency_ms).toBeGreaterThanOrEqual(30);
      expect(res.body.dependencies.stellar.latency_ms).toBeGreaterThanOrEqual(45);
      expect(res.body.dependencies.db.timed_out).toBe(false);
      expect(res.body.dependencies.redis.timed_out).toBe(false);
      expect(res.body.dependencies.stellar.timed_out).toBe(false);
    });
  });

  describe('partial-down scenario', () => {
    test('returns degraded status when database is down', async () => {
      db.raw.mockRejectedValue(new Error('Connection refused'));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.dependencies.db.status).toBe('unhealthy');
      expect(res.body.dependencies.db.error).toBe('Connection refused');
      expect(res.body.dependencies.db.failure_type).toBe('dependency_error');
      expect(res.body.dependencies.db.timed_out).toBe(false);
      expect(res.body.dependencies.db.timeout_ms).toBe(5000);
      expect(res.body.dependencies.redis.status).toBe('healthy');
      expect(res.body.dependencies.stellar.status).toBe('healthy');
    });

    test('returns degraded status when redis is down', async () => {
      redisClient.ping.mockRejectedValue(new Error('Redis unavailable'));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.dependencies.db.status).toBe('healthy');
      expect(res.body.dependencies.redis.status).toBe('unhealthy');
      expect(res.body.dependencies.redis.error).toBe('Redis unavailable');
      expect(res.body.dependencies.redis.failure_type).toBe('dependency_error');
      expect(res.body.dependencies.redis.timed_out).toBe(false);
    });

    test('returns degraded status when stellar is down', async () => {
      horizonServer.root.mockRejectedValue(new Error('Horizon unreachable'));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.dependencies.stellar.status).toBe('unhealthy');
      expect(res.body.dependencies.stellar.error).toBe('Horizon unreachable');
      expect(res.body.dependencies.stellar.failure_type).toBe('dependency_error');
      expect(res.body.dependencies.stellar.timed_out).toBe(false);
    });

    test('returns unhealthy status when all dependencies are down', async () => {
      db.raw.mockRejectedValue(new Error('DB down'));
      redisClient.ping.mockRejectedValue(new Error('Redis down'));
      horizonServer.root.mockRejectedValue(new Error('Stellar down'));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.dependencies.db.status).toBe('unhealthy');
      expect(res.body.dependencies.redis.status).toBe('unhealthy');
      expect(res.body.dependencies.stellar.status).toBe('unhealthy');
    });
  });

  describe('timeout handling', () => {
    test('marks a dependency as unhealthy when it exceeds timeout', async () => {
      db.raw.mockImplementation(() => new Promise(() => {}));

      const result = await healthService.deepHealthCheck({ timeoutMs: 50 });

      expect(result.status).not.toBe('healthy');
      expect(result.dependencies.db.status).toBe('unhealthy');
      expect(result.dependencies.db.error).toMatch(/timed out/);
      expect(result.dependencies.db.failure_type).toBe('timeout');
      expect(result.dependencies.db.timed_out).toBe(true);
      expect(result.dependencies.db.timeout_ms).toBe(50);
      expect(result.dependencies.db.latency_ms).toBeGreaterThanOrEqual(45);
    });
  });

  describe('response shape consistency', () => {
    test('always includes status, timestamp, and dependencies object', async () => {
      const res = await request(app).get('/api/health/deep');

      expect(res.body).toHaveProperty('status');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('dependencies');
      expect(typeof res.body.status).toBe('string');
      expect(typeof res.body.timestamp).toBe('string');
      expect(typeof res.body.dependencies).toBe('object');
    });

    test('each dependency has status and latency fields for dashboards', async () => {
      const res = await request(app).get('/api/health/deep');

      for (const dep of ['db', 'redis', 'stellar']) {
        expect(res.body.dependencies[dep]).toHaveProperty('status');
        expect(res.body.dependencies[dep]).toHaveProperty('latency_ms');
        expect(res.body.dependencies[dep]).toHaveProperty('timeout_ms');
        expect(res.body.dependencies[dep]).toHaveProperty('timed_out');
        expect(typeof res.body.dependencies[dep].status).toBe('string');
        expect(typeof res.body.dependencies[dep].latency_ms).toBe('number');
        expect(typeof res.body.dependencies[dep].timeout_ms).toBe('number');
        expect(typeof res.body.dependencies[dep].timed_out).toBe('boolean');
      }
    });

    test('unhealthy dependencies include stable failure diagnostics', async () => {
      db.raw.mockRejectedValue(new Error('Connection lost'));

      const res = await request(app).get('/api/health/deep');

      expect(res.body.dependencies.db).toHaveProperty('error');
      expect(res.body.dependencies.db).toHaveProperty('failure_type');
      expect(typeof res.body.dependencies.db.error).toBe('string');
      expect(typeof res.body.dependencies.db.failure_type).toBe('string');
      // Healthy dependencies should not have error field
      expect(res.body.dependencies.redis.error).toBeUndefined();
      expect(res.body.dependencies.redis.failure_type).toBeUndefined();
    });

    test('status is one of healthy, degraded, or unhealthy', async () => {
      const res = await request(app).get('/api/health/deep');

      expect(['healthy', 'degraded', 'unhealthy']).toContain(res.body.status);
    });

    test('timestamp is a valid ISO 8601 string', async () => {
      const res = await request(app).get('/api/health/deep');

      const parsed = new Date(res.body.timestamp);
      expect(parsed.toISOString()).toBe(res.body.timestamp);
    });
  });

  describe('soroban and contracts checks', () => {
    test('all checks healthy with configured contracts', async () => {
      process.env.COIN_FLIP_CONTRACT_ID =
        'CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5';
      process.env.RANDOM_GENERATOR_CONTRACT_ID =
        'CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5';
      sorobanService.simulate.mockResolvedValue({ active_game_count: 0 });

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.soroban.status).toBe('healthy');
      expect(res.body.contracts.coinFlip.status).toBe('ok');
      expect(res.body.contracts.randomGenerator.status).toBe('ok');
    });

    test('RPC down → degraded', async () => {
      sorobanRpc.getHealth.mockRejectedValue(new Error('RPC endpoint unreachable'));

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.soroban.status).toBe('unhealthy');
      expect(res.body.soroban.error).toMatch(/RPC endpoint unreachable/);
    });

    test('One contract read failing → degraded, with the right contract flagged', async () => {
      process.env.COIN_FLIP_CONTRACT_ID =
        'CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5';
      process.env.RANDOM_GENERATOR_CONTRACT_ID =
        'CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5';

      sorobanService.simulate.mockImplementation((contractId) => {
        if (contractId === process.env.COIN_FLIP_CONTRACT_ID) {
          throw new Error('Coin flip simulation failed');
        }
        return Promise.resolve({ config: 'active' });
      });

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.contracts.coinFlip.status).toBe('error');
      expect(res.body.contracts.coinFlip.error).toMatch(/Coin flip simulation failed/);
      expect(res.body.contracts.randomGenerator.status).toBe('ok');
    });

    test('missing contract ID config shows as not_configured, not as a crash', async () => {
      delete process.env.COIN_FLIP_CONTRACT_ID;
      delete process.env.RANDOM_GENERATOR_CONTRACT_ID;

      const res = await request(app).get('/api/health/deep');

      expect(res.status).toBe(200);
      expect(res.body.contracts.coinFlip.status).toBe('not_configured');
      expect(res.body.contracts.randomGenerator.status).toBe('not_configured');
    });
  });
});
