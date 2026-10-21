/**
 * Controller for managing wallet transactions (deposits/withdrawals).
 */
const logger = require('../utils/logger');
const audit = require('../services/audit.service');
const {
  assertWalletNetwork,
  getAccountBalances,
  verifyDepositPayment,
} = require('../services/stellar.service');
const TransactionModel = require('../models/Transaction.model');
const User = require('../models/User.model');
const db = require('../config/database');

/**
 * The deposit and withdraw endpoints are switched off until a verified
 * on-chain settlement flow replaces them (issue #1400).
 *
 * `POST /wallet/deposit` used to credit `users.balance` with whatever
 * `amount` the client sent, and `POST /wallet/withdraw` debited the
 * balance, recorded a made-up transaction hash and reported the withdrawal
 * as `completed` without sending anything on-chain. Both were reachable by
 * any signed-in player, so either one could mint or burn balance at will.
 *
 * The implementations below are kept — the deposit one already verifies the
 * payment against Horizon before it credits anything — but the endpoints
 * refuse every request until the flow is switched back on, so no request can
 * change `users.balance`.
 */
const WALLET_FLOW_ENABLED = false;

/**
 * Raised when a client calls the deposit/withdraw endpoints while the
 * on-chain settlement flow is still disabled.
 */
class WalletFlowDisabledError extends Error {
  constructor(operation) {
    super(`${operation} are not available yet: the on-chain settlement flow is not enabled yet.`);
    this.name = 'WalletFlowDisabledError';
    this.statusCode = 501;
    this.code = 'WALLET_FLOW_DISABLED';
  }
}

const validateWalletNetwork = (req) => {
  const expectedNetwork = process.env.STELLAR_NETWORK || 'testnet';
  const walletNetwork = req.headers['x-wallet-network'];
  assertWalletNetwork({ walletNetwork, expectedNetwork });
};

const getBalance = async (req, res, next) => {
  try {
    const { address } = req.params;
    const result = await getAccountBalances(address);

    res.status(200).json({
      address: result.address,
      balances: result.balances,
    });
  } catch (error) {
    next(error);
  }
};

const deposit = async (req, res, next) => {
  // Refuse before anything else runs: no database read, no balance write,
  // and no audit row for a request that is never going to be served.
  if (!WALLET_FLOW_ENABLED) {
    return next(new WalletFlowDisabledError('Deposits'));
  }

  try {
    validateWalletNetwork(req);
    const { txHash, asset } = req.body;
    const walletAddress = req.user.walletAddress || req.user.address;

    if (!walletAddress) {
      return res.status(400).json({ message: 'Wallet address missing from token claims.' });
    }

    const user = await User.findByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ message: 'User profile not found.' });
    }

    const vaultAddress = process.env.VAULT_ADDRESS;
    if (!vaultAddress) {
      const error = new Error('Deposits are not available: no vault address is configured.');
      error.statusCode = 503;
      error.code = 'VAULT_NOT_CONFIGURED';
      throw error;
    }

    if (!txHash || typeof txHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txHash.trim())) {
      const error = new Error(
        'A valid 64-character hex transaction hash (txHash) is required for deposits.'
      );
      error.statusCode = 400;
      error.code = 'INVALID_TX_HASH';
      throw error;
    }

    const cleanTxHash = txHash.trim().toLowerCase();

    // Check for replay before calling Horizon / acquiring row lock
    const existingTx = await db('transactions')
      .where({ tx_hash: cleanTxHash, type: 'deposit' })
      .first();
    if (existingTx) {
      const error = new Error('Deposit transaction has already been credited.');
      error.statusCode = 409;
      error.code = 'DEPOSIT_ALREADY_PROCESSED';
      throw error;
    }

    // Verify on Horizon
    const verification = await verifyDepositPayment({
      txHash: cleanTxHash,
      expectedSource: walletAddress,
      expectedVault: vaultAddress,
      expectedAsset: asset || 'XLM',
    });

    const onChainAmount = verification.numericAmount;
    const creditedAsset = verification.asset;

    logger.info(
      `Deposit verified: ${onChainAmount} ${creditedAsset} for user ${user.id} (tx: ${cleanTxHash})`
    );

    // Credit inside database transaction with row lock
    let txRecord;
    let finalBalance;

    await db.transaction(async (trx) => {
      // Re-check replay inside transaction with lock to guarantee uniqueness under concurrent requests
      const txCheck = await trx('transactions')
        .where({ tx_hash: cleanTxHash, type: 'deposit' })
        .first();
      if (txCheck) {
        const err = new Error('Deposit transaction has already been credited.');
        err.statusCode = 409;
        err.code = 'DEPOSIT_ALREADY_PROCESSED';
        throw err;
      }

      // Lock user row
      const lockedUser = await trx('users').where({ id: user.id }).forUpdate().first();

      if (!lockedUser) {
        const err = new Error('User not found during transaction lock.');
        err.statusCode = 404;
        throw err;
      }

      // Decimal-safe addition (Stellar uses 7 decimal places)
      const currentBalance = Number(lockedUser.balance || 0);
      const newBalanceNum = Number((currentBalance + onChainAmount).toFixed(7));
      finalBalance = newBalanceNum;

      txRecord = await TransactionModel.create(
        {
          user_id: user.id,
          type: 'deposit',
          amount: onChainAmount,
          status: 'success',
          tx_hash: cleanTxHash,
        },
        trx
      );

      await trx('users').where({ id: user.id }).update({
        balance: newBalanceNum,
        updated_at: trx.fn.now(),
      });
    });

    res.status(200).json({
      success: true,
      depositAddress: vaultAddress,
      amount: onChainAmount,
      balance: finalBalance,
      transaction: txRecord,
    });

    audit.log({
      actor: user.wallet_address,
      action: 'wallet.deposit',
      target: user.wallet_address,
      payload: { amount: onChainAmount, asset: creditedAsset, txHash: cleanTxHash },
      outcome: 'success',
    });
  } catch (error) {
    audit.log({
      actor: req.user?.walletAddress || 'anonymous',
      action: 'wallet.deposit',
      target: req.user?.walletAddress || 'unknown',
      outcome: 'failure',
      metadata: { error: error.message },
    });
    next(error);
  }
};

const withdraw = async (req, res, next) => {
  // Refuse before anything else runs: no database read, no balance write,
  // and no audit row for a request that is never going to be served.
  if (!WALLET_FLOW_ENABLED) {
    return next(new WalletFlowDisabledError('Withdrawals'));
  }

  try {
    validateWalletNetwork(req);
    const { amount, destination } = req.body;
    const walletAddress = req.user.walletAddress || req.user.address;

    if (!walletAddress) {
      return res.status(400).json({ message: 'Wallet address missing from token claims.' });
    }

    const user = await User.findByWallet(walletAddress);
    if (!user) {
      return res.status(404).json({ message: 'User profile not found.' });
    }

    const numAmount = parseFloat(amount);
    if (Number.isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ message: 'Invalid withdrawal amount.' });
    }

    if (parseFloat(user.balance || 0) < numAmount) {
      return res.status(400).json({ message: 'Insufficient balance.' });
    }

    logger.info(`Withdrawal request: ${amount} to ${destination} from user ${user.id}`);

    // Create Transaction Record.
    //
    // A verified implementation records the hash of the Stellar transaction
    // it actually submitted here (64 hex characters, no `0x` prefix). Until
    // such a transaction exists there is no honest hash to store, so the
    // column is left null rather than filled with a made-up one.
    const tx = await TransactionModel.create({
      user_id: user.id,
      type: 'withdrawal',
      amount: numAmount,
      status: 'success',
      tx_hash: null,
    });

    // Update User Balance
    const newBalance = parseFloat(user.balance || 0) - numAmount;
    await db('users').where({ id: user.id }).update({
      balance: newBalance,
      updated_at: db.fn.now(),
    });

    res.status(200).json({
      success: true,
      status: 'completed',
      amount: numAmount,
      destination,
      balance: newBalance,
      transaction: tx,
    });

    audit.log({
      actor: user.wallet_address,
      action: 'wallet.withdraw',
      target: destination,
      payload: { amount: numAmount, destination },
      outcome: 'success',
    });
  } catch (error) {
    audit.log({
      actor: req.user?.walletAddress || 'anonymous',
      action: 'wallet.withdraw',
      target: req.body?.destination || 'unknown',
      outcome: 'failure',
      metadata: { error: error.message },
    });
    next(error);
  }
};

module.exports = {
  getBalance,
  deposit,
  withdraw,
  WalletFlowDisabledError,
  WALLET_FLOW_ENABLED,
};
