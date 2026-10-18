/**
 * Unit tests for stellar.service.js
 *
 * All Horizon network calls are mocked — no live HTTP traffic.
 */
'use strict';

jest.mock('../../src/config/stellar', () => ({
  server: {
    submitTransaction: jest.fn(),
    transactions: jest.fn(),
    operations: jest.fn(),
  },
  network: 'testnet',
  passphrase: 'Test SDF Network ; September 2015',
  maxRetries: 2,
  retryInterval: 10,
}));

jest.mock('@stellar/stellar-sdk', () => {
  const real = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...real,
    TransactionBuilder: {
      fromXDR: jest.fn(),
    },
  };
});

const StellarSdk = require('@stellar/stellar-sdk');
const { server } = require('../../src/config/stellar');
const {
  submitTransaction,
  verifyDepositPayment,
  STELLAR_ERRORS,
  _parseHorizonError,
} = require('../../src/services/stellar.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockTx = { type: 'Transaction' }; // opaque stand-in returned by fromXDR

const makeHorizonError = ({ status = 400, resultCodes = null, title = null, code = null } = {}) => {
  const err = new Error(title || `Horizon error ${status}`);
  err.response = {
    status,
    data: {
      title: title || `Error ${status}`,
      ...(resultCodes ? { extras: { result_codes: resultCodes } } : {}),
    },
  };
  if (code) err.code = code;
  return err;
};

const successResponse = {
  hash: 'abc123def456',
  ledger: 42,
  successful: true,
  envelope_xdr: 'AAAAAQ==',
  result_xdr: 'AAAAAAAAAGQ=',
  result_meta_xdr: '',
  paging_token: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stellar.service — submitTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Happy path ---

  test('returns success payload on successful submission', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockResolvedValue(successResponse);

    const result = await submitTransaction('VALID_XDR_BASE64==');

    expect(result.status).toBe('success');
    expect(result.hash).toBe('abc123def456');
    expect(result.ledger).toBe(42);
    expect(result.successful).toBe(true);
    expect(result.envelopeXDR).toBe('AAAAAQ==');
    expect(result.resultXDR).toBe('AAAAAAAAAGQ=');
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.resultCodes).toBeNull();
  });

  test('passes parsed transaction object (not raw XDR) to server.submitTransaction', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockResolvedValue(successResponse);

    await submitTransaction('SOME_XDR==');

    expect(server.submitTransaction).toHaveBeenCalledWith(mockTx);
  });

  test('passes XDR string and passphrase to TransactionBuilder.fromXDR', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockResolvedValue(successResponse);

    await submitTransaction('MY_XDR==');

    expect(StellarSdk.TransactionBuilder.fromXDR).toHaveBeenCalledWith(
      'MY_XDR==',
      'Test SDF Network ; September 2015'
    );
  });

  // --- Invalid XDR ---

  test('returns INVALID_XDR error when XDR cannot be parsed', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockImplementation(() => {
      throw new Error('bad XDR encoding');
    });

    const result = await submitTransaction('NOT_VALID_XDR');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.INVALID_XDR);
    expect(result.errorMessage).toContain('bad XDR encoding');
    expect(result.hash).toBeNull();
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });

  // --- Network / Horizon errors ---

  test('returns TX_FAILED when Horizon returns 400 with result_codes', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    const codes = { transaction: 'tx_failed', operations: ['op_bad_auth'] };
    server.submitTransaction.mockRejectedValue(
      makeHorizonError({ status: 400, resultCodes: codes, title: 'Transaction Failed' })
    );

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.TX_FAILED);
    expect(result.resultCodes).toEqual(codes);
    expect(result.successful).toBe(false);
  });

  test('returns NETWORK_ERROR when Horizon returns 400 without result_codes', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 400 }));

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.NETWORK_ERROR);
  });

  test('returns TIMEOUT on 408 response', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 408, title: 'Timeout' }));

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.TIMEOUT);
  });

  test('returns TIMEOUT when error code is ECONNABORTED', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    const err = new Error('timeout of 30000ms exceeded');
    err.code = 'ECONNABORTED';
    err.response = {};
    server.submitTransaction.mockRejectedValue(err);

    const result = await submitTransaction('XDR==');

    expect(result.errorCode).toBe(STELLAR_ERRORS.TIMEOUT);
  });

  test('returns RATE_LIMITED on 429 response', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 429 }));

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.RATE_LIMITED);
  });

  test('returns SERVER_ERROR on 500 response', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 500 }));

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.SERVER_ERROR);
  });

  test('returns SERVER_ERROR on 503 response', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 503 }));

    const result = await submitTransaction('XDR==');

    expect(result.errorCode).toBe(STELLAR_ERRORS.SERVER_ERROR);
  });

  // --- Retry behavior ---

  test('retries on TIMEOUT and eventually succeeds', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction
      .mockRejectedValueOnce(makeHorizonError({ status: 408 }))
      .mockResolvedValueOnce(successResponse);

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('success');
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  test('retries on SERVER_ERROR and eventually succeeds', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction
      .mockRejectedValueOnce(makeHorizonError({ status: 500 }))
      .mockResolvedValueOnce(successResponse);

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('success');
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  test('retries on RATE_LIMITED and eventually succeeds', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction
      .mockRejectedValueOnce(makeHorizonError({ status: 429 }))
      .mockResolvedValueOnce(successResponse);

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('success');
    expect(server.submitTransaction).toHaveBeenCalledTimes(2);
  });

  test('gives up after maxRetries', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 503 }));

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(server.submitTransaction).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(result.errorCode).toBe(STELLAR_ERRORS.SERVER_ERROR);
  });

  test('does NOT retry on TX_FAILED (400 with result codes)', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(
      makeHorizonError({
        status: 400,
        resultCodes: { transaction: 'tx_failed' },
      })
    );

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(server.submitTransaction).toHaveBeenCalledTimes(1);
    expect(result.errorCode).toBe(STELLAR_ERRORS.TX_FAILED);
  });

  test('returns NETWORK_ERROR for connection refused (no response object)', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8000');
    err.code = 'ECONNREFUSED';
    // no err.response
    server.submitTransaction.mockRejectedValue(err);

    const result = await submitTransaction('XDR==');

    expect(result.status).toBe('error');
    expect(result.errorCode).toBe(STELLAR_ERRORS.NETWORK_ERROR);
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });

  // --- Result shape contract ---

  test('error result always has null hash and ledger', async () => {
    StellarSdk.TransactionBuilder.fromXDR.mockReturnValue(mockTx);
    server.submitTransaction.mockRejectedValue(makeHorizonError({ status: 500 }));

    const result = await submitTransaction('XDR==');

    expect(result.hash).toBeNull();
    expect(result.ledger).toBeNull();
    expect(result.envelopeXDR).toBeNull();
    expect(result.resultXDR).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// _parseHorizonError — unit tests for the error-parsing helper
// ---------------------------------------------------------------------------

describe('stellar.service — _parseHorizonError', () => {
  test('maps 408 to TIMEOUT', () => {
    const result = _parseHorizonError(makeHorizonError({ status: 408 }));
    expect(result.code).toBe(STELLAR_ERRORS.TIMEOUT);
  });

  test('maps ECONNABORTED code to TIMEOUT', () => {
    const err = new Error('timeout');
    err.code = 'ECONNABORTED';
    err.response = {};
    expect(_parseHorizonError(err).code).toBe(STELLAR_ERRORS.TIMEOUT);
  });

  test('maps 429 to RATE_LIMITED', () => {
    expect(_parseHorizonError(makeHorizonError({ status: 429 })).code).toBe(
      STELLAR_ERRORS.RATE_LIMITED
    );
  });

  test('maps 400 + result_codes to TX_FAILED', () => {
    const codes = { transaction: 'tx_bad_seq' };
    const result = _parseHorizonError(makeHorizonError({ status: 400, resultCodes: codes }));
    expect(result.code).toBe(STELLAR_ERRORS.TX_FAILED);
    expect(result.resultCodes).toEqual(codes);
  });

  test('maps 400 without result_codes to NETWORK_ERROR', () => {
    expect(_parseHorizonError(makeHorizonError({ status: 400 })).code).toBe(
      STELLAR_ERRORS.NETWORK_ERROR
    );
  });

  test('maps 500 to SERVER_ERROR', () => {
    expect(_parseHorizonError(makeHorizonError({ status: 500 })).code).toBe(
      STELLAR_ERRORS.SERVER_ERROR
    );
  });

  test('maps 502 to SERVER_ERROR', () => {
    expect(_parseHorizonError(makeHorizonError({ status: 502 })).code).toBe(
      STELLAR_ERRORS.SERVER_ERROR
    );
  });

  test('error without response falls back to NETWORK_ERROR', () => {
    const err = new Error('socket hang up');
    const result = _parseHorizonError(err);
    expect(result.code).toBe(STELLAR_ERRORS.NETWORK_ERROR);
    expect(result.message).toBe('socket hang up');
  });
});

describe('stellar.service — verifyDepositPayment', () => {
  const validHash = 'a'.repeat(64);
  const source = 'GAALICE123456789012345678901234567890123456789012345678';
  const vault = 'GAVAULT123456789012345678901234567890123456789012345678';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects invalid hash format', async () => {
    await expect(
      verifyDepositPayment({ txHash: 'short', expectedSource: source, expectedVault: vault })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TX_HASH' });

    await expect(
      verifyDepositPayment({ txHash: 'g'.repeat(64), expectedSource: source, expectedVault: vault })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TX_HASH' });
  });

  test('rejects when transaction not found on Horizon (404)', async () => {
    const notFoundError = new Error('Not found');
    notFoundError.response = { status: 404 };
    server.transactions.mockReturnValue({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockRejectedValue(notFoundError),
      }),
    });

    await expect(
      verifyDepositPayment({ txHash: validHash, expectedSource: source, expectedVault: vault })
    ).rejects.toMatchObject({ statusCode: 404, code: 'TX_NOT_FOUND' });
  });

  test('rejects when transaction failed on-chain', async () => {
    server.transactions.mockReturnValue({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ successful: false }),
      }),
    });

    await expect(
      verifyDepositPayment({ txHash: validHash, expectedSource: source, expectedVault: vault })
    ).rejects.toMatchObject({ statusCode: 400, code: 'TX_FAILED' });
  });

  test('rejects when no matching payment operation is found', async () => {
    server.transactions.mockReturnValue({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ successful: true, ledger: 100 }),
      }),
    });
    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({
          records: [
            {
              type: 'payment',
              to: 'GWRONGVAULT123',
              from: source,
              asset_type: 'native',
              amount: '50.0000000',
            },
          ],
        }),
      }),
    });

    await expect(
      verifyDepositPayment({ txHash: validHash, expectedSource: source, expectedVault: vault })
    ).rejects.toMatchObject({ statusCode: 400, code: 'PAYMENT_OP_NOT_FOUND' });
  });

  test('succeeds for valid payment and returns parsed amount and asset', async () => {
    server.transactions.mockReturnValue({
      transaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({ successful: true, ledger_attr: 12345 }),
      }),
    });
    server.operations.mockReturnValue({
      forTransaction: jest.fn().mockReturnValue({
        call: jest.fn().mockResolvedValue({
          records: [
            {
              type: 'payment',
              to: vault,
              from: source,
              asset_type: 'native',
              amount: '100.5000000',
            },
          ],
        }),
      }),
    });

    const res = await verifyDepositPayment({
      txHash: validHash,
      expectedSource: source,
      expectedVault: vault,
      expectedAsset: 'XLM',
    });

    expect(res.valid).toBe(true);
    expect(res.amount).toBe('100.5000000');
    expect(res.numericAmount).toBe(100.5);
    expect(res.asset).toBe('XLM');
    expect(res.txHash).toBe(validHash);
    expect(res.ledger).toBe(12345);
  });
});

