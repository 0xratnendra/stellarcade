/**
 * Knex migration for the RNG oracle's seed store.
 *
 * Each row is one server seed and its sha256 commitment. Status moves
 * committed (commitment submitted via commit_seeds) → bound (a
 * RandomRequested event popped this commitment for request_id) → revealed
 * (fulfill_random accepted the seed). The seed column must never be exposed
 * by an API or written to logs while the row is not revealed.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('oracle_seeds', (table) => {
    table.increments('id').primary();
    table.string('commitment', 64).unique().notNullable();
    table.string('seed', 64).notNullable();
    // u64 request id; numeric(20,0) holds the full u64 range.
    table.decimal('request_id', 20, 0).nullable().unique();
    table.string('status', 20).notNullable().defaultTo('committed'); // committed, bound, revealed
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index(['status']);
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
    await knex('worker_cursors').where({ name: 'oracle' }).del();
  }
  await knex.schema.dropTableIfExists('oracle_seeds');
};
