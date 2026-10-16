/**
 * test/setup.js
 * Global setup and teardown for backend tests.
 */
require('dotenv').config({ path: '.env.test' });

// Polyfill BigInt serialization for Jest worker JSON.stringify
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

// Mock database for testing
const knex = require('knex')({
  client: 'sqlite3',
  connection: ':memory:',
  useNullAsDefault: true,
  migrations: {
    directory: require('path').join(__dirname, '../migrations'),
  },
});

// Replace the database export with our test instance
const _databaseConfig = require('../src/config/database');
require.cache[require.resolve('../src/config/database')].exports = knex;

module.exports = async () => {
  // Run migrations for test database
  try {
    await knex.migrate.latest();
    console.log('Test database migrations completed.');
  } catch (error) {
    console.error('Test database migration failed:', error);
  }
};
