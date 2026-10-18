const request = require('supertest');

process.env.CORS_ORIGINS = 'https://app.stellarcade.com,https://staging.stellarcade.com';
process.env.JWT_SECRET = 'test-jwt-secret';

// Mock database connection to prevent process.exit(1)
jest.mock('../../src/config/database', () => {
  const mockKnex = {
    raw: jest.fn().mockResolvedValue({}),
  };
  return mockKnex;
});

// Mock redis connection to prevent connection errors
jest.mock('../../src/config/redis', () => ({
  client: {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue({}),
    isOpen: true,
    quit: jest.fn().mockResolvedValue({}),
  },
  connectPromise: Promise.resolve(),
}));

const app = require('../../src/server');

/**
 * CORS Integration Tests
 *
 * Verifies that:
 * 1. Requests with an allowed Origin header receive Access-Control-Allow-Origin.
 * 2. Requests with a disallowed Origin header receive no Access-Control-Allow-Origin.
 * 3. Requests with no Origin header (server-to-server, health checks) are allowed.
 */
describe('CORS Origin Restriction', () => {
  describe('allowed origins', () => {
    test('sets Access-Control-Allow-Origin for an origin in CORS_ORIGINS', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://app.stellarcade.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.stellarcade.com');
    });

    test('sets Access-Control-Allow-Origin for a second allowed origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://staging.stellarcade.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://staging.stellarcade.com');
    });
  });

  describe('disallowed origins', () => {
    test('does not set Access-Control-Allow-Origin for an unlisted origin', async () => {
      const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('does not set Access-Control-Allow-Origin for localhost when not in CORS_ORIGINS', async () => {
      const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('no Origin header', () => {
    test('allows requests with no Origin header (server-to-server, health checks)', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
