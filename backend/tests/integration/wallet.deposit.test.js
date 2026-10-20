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

const mockVerifyDepositPayment = jest.fn();
jest.mock('../../src/services/stellar.service', () => ({
  assertWalletNetwork: jest.fn(),
  getAccountBalances: jest.fn(),
  verifyDepositPayment: (...args) => mockVerifyDepositPayment(...args),
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
const VALID_HASH = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const app = express();
app.use(express.json());
app.use('/wallet', router);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { message: err.message, code: err.code } });
});

/**
 * The deposit endpoint is disabled until a verified on-chain settlement flow
 * replaces it (issue #1400): it used to credit `users.balance` with whatever
 * the client sent, so any signed-in player could mint balance for themselves.
 *
 * These tests run against the real in-memory database, so "the balance is
 * unchanged" is checked against the row that is actually stored, not against
 * a mock that was never asked to change anything.
 */
describe('POST /wallet/deposit (flow disabled)', () => {
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

  test('501s with WALLET_FLOW_DISABLED instead of accepting a deposit', async () => {
    const res = await request(app).post('/wallet/deposit').send({ txHash: VALID_HASH });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('WALLET_FLOW_DISABLED');
    expect(res.body.error.message).toMatch(/not available yet/i);
  });

  test('leaves the balance exactly as it was', async () => {
    const res = await request(app)
      .post('/wallet/deposit')
      .send({ txHash: VALID_HASH, amount: 999 });

    expect(res.status).toBe(501);

    const user = await db('users').where({ wallet_address: WALLET }).first();
    expect(Number(user.balance)).toBe(STARTING_BALANCE);
  });

  test('writes no transaction record', async () => {
    await request(app).post('/wallet/deposit').send({ txHash: VALID_HASH });

    const transactions = await db('transactions').select('*');
    expect(transactions).toHaveLength(0);
  });

  test('never looks the payment up on Horizon', async () => {
    await request(app).post('/wallet/deposit').send({ txHash: VALID_HASH });

    expect(mockVerifyDepositPayment).not.toHaveBeenCalled();
  });

  test('writes no audit row for a request that was never served', async () => {
    await request(app).post('/wallet/deposit').send({ txHash: VALID_HASH });

    expect(audit.log).not.toHaveBeenCalled();
  });

  test('refuses the request whatever the body says', async () => {
    const res = await request(app).post('/wallet/deposit').send({ amount: 999 });

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('WALLET_FLOW_DISABLED');
  });
});
