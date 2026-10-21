const request = require('supertest');
const express = require('express');

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

jest.mock('../../src/services/stellar.service', () => ({
  assertWalletNetwork: jest.fn(),
  getAccountBalances: jest.fn(),
  verifyDepositPayment: jest.fn(),
}));

jest.mock('../../src/middleware/auth.middleware', () => (req, res, next) => {
  req.user = { id: 1, walletAddress: 'GALICE1234567890' };
  next();
});

jest.mock('../../src/middleware/idempotency.middleware', () => (req, res, next) => next());

jest.mock('../../src/services/audit.service', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../../src/config/database');
const router = require('../../src/routes/wallet.routes');
const audit = require('../../src/services/audit.service');

const WALLET = 'GALICE1234567890';
const STARTING_BALANCE = 10;

const app = express();
app.use(express.json());
app.use('/wallet', router);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { message: err.message, code: err.code } });
});

/**
 * The withdraw endpoint is disabled until a verified on-chain settlement flow
 * replaces it (issue #1400): it used to debit `users.balance`, record a
 * made-up transaction hash and report the withdrawal as completed without
 * sending anything on-chain.
 *
 * These tests run against the real in-memory database, so "the balance is
 * unchanged" is checked against the row that is actually stored.
 */
describe('POST /wallet/withdraw (flow disabled)', () => {
  beforeAll(async () => {
    await db.migrate.latest();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await db('transactions').del();
    await db('users').del();
    await db('users').insert({
      wallet_address: WALLET,
      username: 'alice',
      balance: STARTING_BALANCE,
    });
  });

  afterAll(async () => {
    await db.destroy();
  });

  test('501s with WALLET_FLOW_DISABLED instead of accepting a withdrawal', async () => {
    const res = await request(app)
      .post('/wallet/withdraw')
      .send({ amount: 5, destination: 'GBOB1234567890' });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('WALLET_FLOW_DISABLED');
    expect(res.body.error.message).toMatch(/not available yet/i);
  });

  test('leaves the balance exactly as it was', async () => {
    const res = await request(app)
      .post('/wallet/withdraw')
      .send({ amount: 5, destination: 'GBOB1234567890' });

    expect(res.status).toBe(501);

    const user = await db('users').where({ wallet_address: WALLET }).first();
    expect(Number(user.balance)).toBe(STARTING_BALANCE);
  });

  test('writes no transaction record and no made-up transaction hash', async () => {
    await request(app).post('/wallet/withdraw').send({ amount: 5, destination: 'GBOB1234567890' });

    const transactions = await db('transactions').select('*');
    expect(transactions).toHaveLength(0);
  });

  test('writes no audit row for a request that was never served', async () => {
    await request(app).post('/wallet/withdraw').send({ amount: 5, destination: 'GBOB1234567890' });

    expect(audit.log).not.toHaveBeenCalled();
  });

  test('refuses the request whatever the body says', async () => {
    const res = await request(app).post('/wallet/withdraw').send({});

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('WALLET_FLOW_DISABLED');
  });
});
