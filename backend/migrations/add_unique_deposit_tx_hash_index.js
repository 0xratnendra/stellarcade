/**
 * Migration to add unique index on transactions (tx_hash) where type = 'deposit'.
 * Prevents double-crediting deposit replays on the database level.
 */

exports.up = async function (knex) {
  const isPg = knex.client.config.client === 'postgresql' || knex.client.config.client === 'pg';
  if (isPg) {
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_deposit_tx_hash
      ON transactions (tx_hash)
      WHERE type = 'deposit' AND tx_hash IS NOT NULL;
    `);
  } else {
    await knex.schema.alterTable('transactions', (table) => {
      table.unique(['tx_hash', 'type']);
    });
  }
};

exports.down = async function (knex) {
  const isPg = knex.client.config.client === 'postgresql' || knex.client.config.client === 'pg';
  if (isPg) {
    await knex.raw('DROP INDEX IF EXISTS idx_transactions_deposit_tx_hash;');
  } else {
    await knex.schema.alterTable('transactions', (table) => {
      table.dropUnique(['tx_hash', 'type']);
    });
  }
};
