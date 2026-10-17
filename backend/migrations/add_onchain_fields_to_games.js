/**
 * Knex migration adding on-chain coin-flip fields to games, plus the
 * worker_cursors table the chain workers use to resume event polling.
 *
 * games rows written by the indexer are keyed by (contract_id, chain_game_id)
 * so replaying the same contract events is an upsert, never a duplicate.
 * user_id becomes nullable so bets from wallets without an account are still
 * indexed.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('games', (table) => {
    table.string('contract_id', 56).nullable();
    // u64 on-chain; numeric(20,0) holds the full u64 range, which a signed
    // bigint cannot.
    table.decimal('chain_game_id', 20, 0).nullable();
    table.string('player_address', 56).nullable();
    table.string('side', 10).nullable(); // heads, tails
    table.string('status', 20).nullable(); // pending, resolved
    table.integer('ledger').nullable();
    table.string('resolve_tx_hash', 64).nullable();
    table.timestamp('resolved_at').nullable();

    table.unique(['contract_id', 'chain_game_id']);
    table.index(['player_address']);
  });

  await knex.schema.alterTable('games', (table) => {
    table.integer('user_id').unsigned().nullable().alter();
  });

  if (!(await knex.schema.hasTable('worker_cursors'))) {
    await knex.schema.createTable('worker_cursors', (table) => {
      table.string('name', 50).primary();
      table.string('cursor', 128).notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  if (await knex.schema.hasTable('worker_cursors')) {
    await knex('worker_cursors').where({ name: 'indexer' }).del();
  }

  // Rows without a user cannot satisfy the restored NOT NULL constraint.
  await knex('games').whereNull('user_id').del();

  await knex.schema.alterTable('games', (table) => {
    table.dropUnique(['contract_id', 'chain_game_id']);
    table.dropIndex(['player_address']);
    table.dropColumn('contract_id');
    table.dropColumn('chain_game_id');
    table.dropColumn('player_address');
    table.dropColumn('side');
    table.dropColumn('status');
    table.dropColumn('ledger');
    table.dropColumn('resolve_tx_hash');
    table.dropColumn('resolved_at');
  });

  await knex.schema.alterTable('games', (table) => {
    table.integer('user_id').unsigned().notNullable().alter();
  });
};
