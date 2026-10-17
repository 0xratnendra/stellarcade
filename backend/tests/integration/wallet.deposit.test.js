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

const mockDbUpdate = jest.fn().mockResolvedValue(1);
const mockDbFirst = jest.fn().mockResolvedValue(null);
const mockDbForUpdate = jest.fn().mockReturnValue({ first: mockDbFirst });
const mockDbWhere = jest.fn().mockReturnValue({
  first: mockDbFirst,
  update: mockDbUpdate,
  forUpdate: mockDbForUpdate,
});
const mockDb = jest.fn((_table) => ({
  where: mockDbWhere,
  update: mockDbUpdate,
  first: mockDbFirst,
}));
mockDb.fn = { now: jest.fn(() => 'NOW()') };
mockDb.transaction = jest.fn(async (cb) => {
  const trx = jest.fn((_table) => ({
    where: mockDbWhere,
    update: mockDbUpdate,
    first: mockDbFirst,
  }));
  trx.fn = { now: jest.fn(() => 'NOW()') };
  return cb(trx);
});
jest.mock('../../src/config/database', () => mockDb);

const router = require('../../src/routes/wallet.routes');
const User = require('../../src/models/User.model');
const TransactionModel = require('../../src/models/Transaction.model');

jest.mock('../../src/models/User.model');
jest.mock('../../src/models/Transaction.model');

const app = express();
app.use(express.json());
app.use('/wallet', router);
app.use((err, req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { message: err.message, code: err.code } });
});

describe('POST /wallet/deposit', () => {
  const originalVaultAddress = process.env.VAULT_ADDRESS;
  const validHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbUpdate.mockResolvedValue(1);
    mockDbFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.VAULT_ADDRESS = originalVaultAddress;
  });

  test('503s with an honest error when no vault address is configured', async () => {
    delete process.env.VAULT_ADDRESS;
    User.findByWallet.mockResolvedValue({
      id: 1,
      wallet_address: 'GALICE1234567890',
      balance: '10',
    });

    const res = await request(app).post('/wallet/deposit').send({ txHash: validHash });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('VAULT_NOT_CONFIGURED');
  });

  test('400s when txHash is missing or invalid hex length', async () => {
    process.env.VAULT_ADDRESS = 'G' + 'A'.repeat(55);
    User.findByWallet.mockResolvedValue({
      id: 1,
      wallet_address: 'GALICE1234567890',
      balance: '10',
    });

    const res1 = await request(app).post('/wallet/deposit').send({});
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe('INVALID_TX_HASH');

    const res2 = await request(app).post('/wallet/deposit').send({ txHash: 'short' });
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe('INVALID_TX_HASH');
  });

  test('409s when deposit hash was already processed (replay protection)', async () => {
    process.env.VAULT_ADDRESS = 'G' + 'A'.repeat(55);
    User.findByWallet.mockResolvedValue({
      id: 1,
      wallet_address: 'GALICE1234567890',
      balance: '10',
    });
    mockDbFirst.mockResolvedValueOnce({ id: 5, tx_hash: validHash });

    const res = await request(app).post('/wallet/deposit').send({ txHash: validHash });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEPOSIT_ALREADY_PROCESSED');
  });

  test('verifies on-chain payment, credits verified amount, and locks user row', async () => {
    process.env.VAULT_ADDRESS = 'G' + 'A'.repeat(55);
    User.findByWallet.mockResolvedValue({
      id: 1,
      wallet_address: 'GALICE1234567890',
      balance: '10',
    });
    // First call to first() -> replay check in outer db (null)
    // Second call -> replay check inside trx (null)
    // Third call -> lockedUser inside trx ({ id: 1, balance: '10.5000000' })
    mockDbFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, balance: '10.5000000' });

    mockVerifyDepositPayment.mockResolvedValue({
      valid: true,
      amount: '25.0000000',
      numericAmount: 25.0,
      asset: 'XLM',
      txHash: validHash,
      ledger: 1000,
    });

    TransactionModel.create.mockResolvedValue({
      id: 99,
      type: 'deposit',
      amount: 25.0,
      tx_hash: validHash,
    });

    const res = await request(app)
      .post('/wallet/deposit')
      .send({ txHash: validHash, amount: 999 }); // amount 999 should be ignored

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(25.0);
    expect(res.body.balance).toBe(35.5);
    expect(res.body.depositAddress).toBe(process.env.VAULT_ADDRESS);
    expect(mockVerifyDepositPayment).toHaveBeenCalledWith({
      txHash: validHash,
      expectedSource: 'GALICE1234567890',
      expectedVault: process.env.VAULT_ADDRESS,
      expectedAsset: 'XLM',
    });
  });

  test('404s when the authenticated wallet has no profile yet', async () => {
    process.env.VAULT_ADDRESS = 'G' + 'A'.repeat(55);
    User.findByWallet.mockResolvedValue(null);

    const res = await request(app).post('/wallet/deposit').send({ txHash: validHash });

    expect(res.status).toBe(404);
  });
});
