/**
 * Stellar Network Transaction Service
 *
 * Core service for submitting and monitoring transactions on the Stellar network.
 * This service is the primary interface between the backend and all Soroban smart contracts.
 *
 * ## Contract Interactions
 * This service interacts with ALL smart contracts in the Stellarcade ecosystem:
 *
 * ### Core Infrastructure Contracts
 * - `prize-pool`: Fund deposits, prize reservations, payouts
 * - `treasury`: Treasury deposits, allocations, releases
 * - `random-generator`: Randomness requests, result retrieval
 * - `access-control`: Admin role management
 * - `contract-address-registry`: Contract address lookups
 *
 * ### Game Contracts
 * - `coin-flip`: Place bets, resolve games
 * - `daily-trivia`: Start games, submit answers
 * - `speed-trivia`: Fast-paced trivia games
 * - `dice-roll`: Roll dice, get results
 * - `number-guess`: Submit guesses, resolve games
 * - `pattern-puzzle`: Submit patterns, verify solutions
 * - `wordle-clone`: Start games, submit guesses
 * - `color-prediction`: Submit predictions, get results
 * - `higher-lower`: Submit guesses, resolve games
 * - `price-prediction`: Submit predictions, settle outcomes
 *
 * ### Platform Feature Contracts
 * - `leaderboard`: Score updates, rank queries
 * - `staking`: Stake tokens, claim rewards
 * - `governance`: Create proposals, vote
 * - `referral-system`: Register referrals, claim rewards
 * - `tournament-system`: Create tournaments, join, settle
 * - `matchmaking-queue`: Join/leave queues, match players
 * - `multiplayer-room`: Create rooms, join, manage state
 *
 * ### Cross-Contract & Utility Contracts
 * - `cross-chain-bridge`: Bridge assets between chains
 * - `cross-contract-handler`: Coordinate multi-contract calls
 * - `oracle-integration`: Request oracle data
 * - `session-nonce-manager`: Generate/validate session nonces
 * - `contract-upgrade-timelock`: Schedule and execute upgrades
 *
 * ## Transaction Flow
 *
 * 1. Service receives base64-encoded TransactionEnvelope XDR
 * 2. Deserializes and validates XDR structure
 * 3. Submits transaction to configured Horizon/Soroban RPC endpoint
 * 4. Parses response or error from network
 * 5. Returns structured result with hash, ledger, success status
 *
 * ## Error Handling
 *
 * All errors are parsed into structured format with:
 * - `code`: Machine-readable error code (e.g., 'TX_FAILED', 'TIMEOUT')
 * - `message`: Human-readable error description
 * - `resultCodes`: Detailed Horizon result codes (if available)
 * - `httpStatus`: HTTP status code from Horizon (if applicable)
 *
 * ## Fail-Open Design
 *
 * In case of network errors or Horizon unavailability, the service
 * returns structured error responses instead of throwing exceptions.
 * This allows callers to implement retry logic with proper backoff.
 *
 * @see {@link ../../docs/ARCHITECTURE.md#backend-contract-interaction-matrix} for full interaction matrix
 * @see {@link ../../docs/contracts/README.md} for contract reference
 *
 * @example
 * // Submit a transaction to the prize-pool contract
 * const stellarService = require('./stellar.service');
 *
 * const result = await stellarService.submitTransaction(transactionXDR);
 *
 * if (result.status === 'success') {
 *   console.log(`Transaction successful: ${result.hash}`);
 * } else {
 *   console.error(`Transaction failed: ${result.errorMessage}`);
 *   // Implement retry logic with backoff
 * }
 */
const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('../utils/logger');
const { server, passphrase, maxRetries, retryInterval } = require('../config/stellar');
const Outbox = require('../models/Outbox.model');

/**
 * Utility to wait for a specified duration.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class NetworkMismatchError extends Error {
  constructor({ expectedNetwork, receivedNetwork }) {
    super(
      `Wallet network mismatch: expected ${expectedNetwork}, received ${receivedNetwork}. Please switch your wallet network and try again.`
    );
    this.name = 'NetworkMismatchError';
    this.code = 'NETWORK_MISMATCH';
    this.statusCode = 400;
    this.expectedNetwork = expectedNetwork;
    this.receivedNetwork = receivedNetwork;
  }
}

/**
 * Error codes returned in the service result for structured error handling by callers.
 */
const STELLAR_ERRORS = {
  INVALID_XDR: 'INVALID_XDR',
  TX_FAILED: 'TX_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
};

/**
 * Parse a Horizon error response into a structured object.
 * Horizon wraps submission failures inside response.data.extras.result_codes.
 *
 * @param {import('@stellar/stellar-sdk').NetworkError} err
 * @returns {{ code: string, message: string, resultCodes: object|null, httpStatus: number|null }}
 */
const parseHorizonError = (err) => {
  const response = err.response || {};
  const httpStatus = response.status || null;
  const data = response.data || {};
  const resultCodes = data.extras?.result_codes || null;

  // 408 / ECONNABORTED / ERR_CANCELED → timeout
  if (
    httpStatus === 408 ||
    err.code === 'ECONNABORTED' ||
    err.code === 'ERR_CANCELED' ||
    /timeout/i.test(err.message || '')
  ) {
    return { code: STELLAR_ERRORS.TIMEOUT, message: 'Request timed out', resultCodes, httpStatus };
  }

  // 429 → rate limited
  if (httpStatus === 429) {
    return {
      code: STELLAR_ERRORS.RATE_LIMITED,
      message: 'Horizon rate limit exceeded',
      resultCodes,
      httpStatus,
    };
  }

  // 400 with result_codes → transaction was submitted but failed on-chain
  if (httpStatus === 400 && resultCodes) {
    return {
      code: STELLAR_ERRORS.TX_FAILED,
      message: data.title || 'Transaction failed',
      resultCodes,
      httpStatus,
    };
  }

  // 5xx → Horizon server error
  if (httpStatus >= 500) {
    return {
      code: STELLAR_ERRORS.SERVER_ERROR,
      message: data.title || `Horizon server error (${httpStatus})`,
      resultCodes,
      httpStatus,
    };
  }

  // fallback
  return {
    code: STELLAR_ERRORS.NETWORK_ERROR,
    message: err.message || 'Unknown network error',
    resultCodes,
    httpStatus,
  };
};

/**
 * Submit a base64-encoded Stellar transaction XDR to the configured Horizon endpoint.
 *
 * @param {string} transactionXDR - Base64-encoded TransactionEnvelope XDR string.
 * @returns {Promise<{
 *   status: 'success'|'error',
 *   hash: string|null,
 *   ledger: number|null,
 *   successful: boolean,
 *   envelopeXDR: string|null,
 *   resultXDR: string|null,
 *   errorCode: string|null,
 *   errorMessage: string|null,
 *   resultCodes: object|null,
 * }>}
 */
const submitTransaction = async (transactionXDR) => {
  // --- 1. Deserialise and validate XDR ---
  let transaction;
  try {
    transaction = StellarSdk.TransactionBuilder.fromXDR(transactionXDR, passphrase);
  } catch (parseErr) {
    logger.warn('Invalid transaction XDR supplied:', parseErr.message);
    return {
      status: 'error',
      hash: null,
      ledger: null,
      successful: false,
      envelopeXDR: null,
      resultXDR: null,
      errorCode: STELLAR_ERRORS.INVALID_XDR,
      errorMessage: `Invalid XDR: ${parseErr.message}`,
      resultCodes: null,
    };
  }

  const normalizedMaxRetries = Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : 0;
  const normalizedRetryInterval =
    Number.isFinite(retryInterval) && retryInterval >= 0 ? retryInterval : 0;

  // --- 2. Submit to Horizon with Retry Policy ---
  let attempt = 0;
  let lastError = null;

  while (attempt <= normalizedMaxRetries) {
    if (attempt > 0) {
      logger.info(
        `Retrying transaction submission (attempt ${attempt}/${normalizedMaxRetries})...`
      );
      await sleep(normalizedRetryInterval);
    } else {
      logger.info('Submitting transaction to Stellar network...');
    }

    try {
      const response = await server.submitTransaction(transaction);

      logger.info(
        `Transaction submitted successfully. hash=${response.hash} ledger=${response.ledger}`
      );

      return {
        status: 'success',
        hash: response.hash,
        ledger: response.ledger,
        successful: response.successful,
        envelopeXDR: response.envelope_xdr,
        resultXDR: response.result_xdr,
        errorCode: null,
        errorMessage: null,
        resultCodes: null,
      };
    } catch (err) {
      const parsed = parseHorizonError(err);
      lastError = parsed;

      // Only retry for certain errors
      const retriable = [
        STELLAR_ERRORS.TIMEOUT,
        STELLAR_ERRORS.SERVER_ERROR,
        STELLAR_ERRORS.RATE_LIMITED,
        STELLAR_ERRORS.NETWORK_ERROR,
      ].includes(parsed.code);

      if (!retriable || attempt >= normalizedMaxRetries) {
        logger.error(
          `Transaction submission failed. code=${parsed.code} httpStatus=${parsed.httpStatus} message=${parsed.message} attempts=${attempt + 1}`,
          { resultCodes: parsed.resultCodes }
        );
        break;
      }

      logger.warn(
        `Transient error during submission. code=${parsed.code} httpStatus=${parsed.httpStatus} message=${parsed.message}. Will retry.`
      );
      attempt++;
    }
  }

  const resolvedError = lastError || {
    code: STELLAR_ERRORS.NETWORK_ERROR,
    message: 'Transaction submission failed before any network attempt.',
    resultCodes: null,
  };

  return {
    status: 'error',
    hash: null,
    ledger: null,
    successful: false,
    envelopeXDR: null,
    resultXDR: null,
    errorCode: resolvedError.code,
    errorMessage: resolvedError.message,
    resultCodes: resolvedError.resultCodes,
  };
};

/**
 * Add a transaction to the outbox for deferred processing.
 * This provides idempotent retry semantics and observability.
 *
 * @param {string} transactionXDR - Base64-encoded TransactionEnvelope XDR string.
 * @returns {Promise<{
 *   status: 'queued'|'error',
 *   outboxId: string|null,
 *   errorCode: string|null,
 *   errorMessage: string|null,
 * }>}
 */
const submitTransactionAsync = async (transactionXDR) => {
  // Validate XDR before adding to outbox
  let _transaction;
  try {
    _transaction = StellarSdk.TransactionBuilder.fromXDR(transactionXDR, passphrase);
  } catch (parseErr) {
    logger.warn('Invalid transaction XDR supplied for async submission:', parseErr.message);
    return {
      status: 'error',
      outboxId: null,
      errorCode: STELLAR_ERRORS.INVALID_XDR,
      errorMessage: `Invalid XDR: ${parseErr.message}`,
    };
  }

  try {
    const outbox = await Outbox.create({
      transaction_xdr: transactionXDR,
    });

    logger.info(`Transaction queued for deferred processing. outboxId=${outbox.id}`);

    return {
      status: 'queued',
      outboxId: outbox.id,
      errorCode: null,
      errorMessage: null,
    };
  } catch (err) {
    logger.error('Failed to queue transaction for deferred processing:', err);
    return {
      status: 'error',
      outboxId: null,
      errorCode: 'OUTBOX_ERROR',
      errorMessage: `Failed to queue transaction: ${err.message}`,
    };
  }
};

/**
 * Fetch an address's real on-chain balances from Horizon — not an internal
 * ledger figure. A syntactically valid address that has never received XLM
 * doesn't exist as an account on-chain yet (Horizon 404s for it); that's a
 * normal, expected state, not an error, so it resolves to a zero balance
 * with `exists: false` rather than throwing.
 *
 * @param {string} address - Stellar public key (G...)
 * @returns {Promise<{ address: string, balances: Record<string, string>, exists: boolean }>}
 */
const getAccountBalances = async (address) => {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
    const error = new Error(`"${address}" is not a valid Stellar public key.`);
    error.statusCode = 400;
    error.code = 'INVALID_ADDRESS';
    throw error;
  }

  try {
    const account = await server.loadAccount(address);
    const balances = {};
    for (const balance of account.balances) {
      const key =
        balance.asset_type === 'native' ? 'XLM' : balance.asset_code || balance.asset_type;
      balances[key] = balance.balance;
    }
    return { address, balances, exists: true };
  } catch (err) {
    if (err instanceof StellarSdk.NotFoundError) {
      return { address, balances: { XLM: '0.0000000' }, exists: false };
    }

    const parsed = parseHorizonError(err);
    const error = new Error(parsed.message);
    error.statusCode = parsed.httpStatus && parsed.httpStatus < 500 ? parsed.httpStatus : 502;
    error.code = parsed.code;
    throw error;
  }
};

const normalizeNetworkName = (networkName) => {
  return String(networkName || '')
    .trim()
    .toLowerCase();
};

const assertWalletNetwork = ({ walletNetwork, expectedNetwork }) => {
  const normalizedWalletNetwork = normalizeNetworkName(walletNetwork);
  const normalizedExpectedNetwork = normalizeNetworkName(expectedNetwork);

  if (!normalizedWalletNetwork || normalizedWalletNetwork !== normalizedExpectedNetwork) {
    throw new NetworkMismatchError({
      expectedNetwork: normalizedExpectedNetwork || 'unknown',
      receivedNetwork: normalizedWalletNetwork || 'unknown',
    });
  }
};

/**
 * Verifies that a deposit payment exists, succeeded, and matches expected criteria on Horizon.
 *
 * @param {Object} params
 * @param {string} params.txHash - 64-character hex transaction hash
 * @param {string} params.expectedSource - Sender Stellar account (G...)
 * @param {string} params.expectedVault - Recipient vault Stellar account (G...)
 * @param {string} [params.expectedAsset='XLM'] - Asset code expected ('XLM' or asset code)
 * @returns {Promise<{ valid: boolean, amount: string, numericAmount: number, asset: string, txHash: string, ledger: number }>}
 */
const verifyDepositPayment = async ({
  txHash,
  expectedSource,
  expectedVault,
  expectedAsset = 'XLM',
}) => {
  if (!txHash || typeof txHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txHash.trim())) {
    const error = new Error('Invalid transaction hash format. Expected 64 hex characters.');
    error.statusCode = 400;
    error.code = 'INVALID_TX_HASH';
    throw error;
  }

  const cleanTxHash = txHash.trim().toLowerCase();

  let tx;
  try {
    tx = await server.transactions().transaction(cleanTxHash).call();
  } catch (err) {
    if (err instanceof StellarSdk.NotFoundError || err?.response?.status === 404) {
      const error = new Error(`Transaction ${cleanTxHash} not found on network.`);
      error.statusCode = 404;
      error.code = 'TX_NOT_FOUND';
      throw error;
    }
    const parsed = parseHorizonError(err);
    const error = new Error(parsed.message || 'Failed to fetch transaction from Horizon.');
    error.statusCode = parsed.httpStatus && parsed.httpStatus < 500 ? parsed.httpStatus : 502;
    error.code = parsed.code || 'HORIZON_ERROR';
    throw error;
  }

  if (!tx.successful) {
    const error = new Error('Deposit transaction was not successful on-chain.');
    error.statusCode = 400;
    error.code = 'TX_FAILED';
    throw error;
  }

  let operationsResponse;
  try {
    operationsResponse = await server.operations().forTransaction(cleanTxHash).call();
  } catch (err) {
    const parsed = parseHorizonError(err);
    const error = new Error(parsed.message || 'Failed to fetch operations for transaction.');
    error.statusCode = parsed.httpStatus && parsed.httpStatus < 500 ? parsed.httpStatus : 502;
    error.code = parsed.code || 'HORIZON_ERROR';
    throw error;
  }

  const operations = operationsResponse.records || [];
  const normalizedExpectedAsset = (expectedAsset || 'XLM').toUpperCase();

  const matchingOp = operations.find((op) => {
    if (op.type !== 'payment') return false;
    if (op.to !== expectedVault) return false;

    const opSource = op.from || op.source_account || tx.source_account;
    if (opSource !== expectedSource) return false;

    if (normalizedExpectedAsset === 'XLM' || normalizedExpectedAsset === 'NATIVE') {
      return op.asset_type === 'native';
    } else {
      return (op.asset_code || '').toUpperCase() === normalizedExpectedAsset;
    }
  });

  if (!matchingOp) {
    const error = new Error(
      `No matching payment operation found in transaction for vault ${expectedVault} from ${expectedSource}.`
    );
    error.statusCode = 400;
    error.code = 'PAYMENT_OP_NOT_FOUND';
    throw error;
  }

  const numericAmount = parseFloat(matchingOp.amount);
  if (Number.isNaN(numericAmount) || numericAmount <= 0) {
    const error = new Error('Invalid payment amount in transaction operation.');
    error.statusCode = 400;
    error.code = 'INVALID_PAYMENT_AMOUNT';
    throw error;
  }

  return {
    valid: true,
    amount: matchingOp.amount,
    numericAmount,
    asset: matchingOp.asset_type === 'native' ? 'XLM' : matchingOp.asset_code,
    txHash: cleanTxHash,
    ledger: tx.ledger_attr || tx.ledger || 0,
  };
};

module.exports = {
  submitTransaction,
  submitTransactionAsync,
  assertWalletNetwork,
  getAccountBalances,
  verifyDepositPayment,
  STELLAR_ERRORS,
  NetworkMismatchError,
  // exported for testing only
  _parseHorizonError: parseHorizonError,
};
