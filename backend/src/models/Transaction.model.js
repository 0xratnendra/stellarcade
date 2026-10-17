/**
 * Base model for Wallet Transactions.
 */
const db = require('../config/database');
const logger = require('../utils/logger');

const TransactionModel = {
  /**
   * Creates a transaction row.
   *
   * @param {Object} transactionData
   * @param {Object} [trx]
   * @returns {Promise<Object|null>}
   */
  async create(transactionData, trx = null) {
    try {
      const q = trx ? trx('transactions') : db('transactions');
      const rows = await q.insert(transactionData).returning('*');
      return rows[0] || null;
    } catch (error) {
      logger.error('Error in TransactionModel.create:', error);
      throw error;
    }
  },

  /**
   * Finds a single transaction by tx_hash.
   *
   * @param {string} txHash
   * @param {string} [type]
   * @returns {Promise<Object|null>}
   */
  async findByTxHash(txHash, type) {
    try {
      const query = db('transactions').where({ tx_hash: txHash });
      if (type) {
        query.where({ type });
      }
      const transaction = await query.first();
      return transaction || null;
    } catch (error) {
      logger.error('Error in TransactionModel.findByTxHash:', error);
      throw error;
    }
  },

  /**
   * Finds a single transaction by id.
   *
   * @param {number|string} transactionId
   * @returns {Promise<Object|null>}
   */
  async findById(transactionId) {
    try {
      const transaction = await db('transactions').where({ id: transactionId }).first();
      return transaction || null;
    } catch (error) {
      logger.error('Error in TransactionModel.findById:', error);
      throw error;
    }
  },

  /**
   * Lists transactions for a user with pagination.
   *
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number} [params.page=1]
   * @param {number} [params.limit=10]
   * @param {string} [params.type]
   * @param {string} [params.status]
   * @returns {Promise<{items: Array, total: number, page: number, pageSize: number}>}
   */
  async listByUser({ userId, page = 1, limit = 10, type, status }) {
    try {
      const safePage = Math.max(Number(page) || 1, 1);
      const safeLimit = Math.max(Number(limit) || 10, 1);
      const offset = (safePage - 1) * safeLimit;

      const query = db('transactions').where({ user_id: userId });

      if (type) {
        query.where({ type });
      }

      if (status) {
        query.where({ status });
      }

      const countQuery = query.clone().count('* as total').first();
      const itemsQuery = query
        .clone()
        .orderBy('created_at', 'desc')
        .limit(safeLimit)
        .offset(offset);

      const [items, countRow] = await Promise.all([itemsQuery, countQuery]);
      const total = Number(countRow?.total || 0);

      return { items, total, page: safePage, pageSize: safeLimit };
    } catch (error) {
      logger.error('Error in TransactionModel.listByUser:', error);
      throw error;
    }
  },

  /**
   * Updates a transaction row and returns updated record.
   *
   * @param {number|string} transactionId
   * @param {Object} patch
   * @returns {Promise<Object|null>}
   */
  async update(transactionId, patch) {
    try {
      const rows = await db('transactions')
        .where({ id: transactionId })
        .update(patch)
        .returning('*');
      return rows[0] || null;
    } catch (error) {
      logger.error('Error in TransactionModel.update:', error);
      throw error;
    }
  },
};

module.exports = TransactionModel;
