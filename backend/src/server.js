/**
 * Stellarcade Backend - Main Express Server
 *
 * This file initializes the Express application, mounts middleware,
 * defines routes, and starts the server.
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

// Config and Utils
const logger = require('./utils/logger');
const { validateStartupConfig } = require('./config/startupValidation');

// Middleware
const correlationId = require('./middleware/correlation-id.middleware');
const errorHandler = require('./middleware/errorHandler.middleware');
const apiVersionMiddleware = require('./middleware/api-version.middleware');

// Routes
const routes = require('./routes');

const app = express();

const bodySizeLimit = process.env.BODY_SIZE_LIMIT || '100kb';

validateStartupConfig();
const db = require('./config/database');
const redis = require('./config/redis');

/**
 * CORS Configuration
 * Only allow origins listed in CORS_ORIGINS (comma-separated).
 * Requests with no Origin header (server-to-server, health checks) are allowed.
 */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
};

/**
 * Standard Security and Utility Middleware
 */
app.use(correlationId); // Must be very early for full request-lifecycle coverage
app.use(helmet()); // Basic security headers
app.use(cors(corsOptions)); // Enable Cross-Origin Resource Sharing for allowed origins only
app.use(
  express.json({
    limit: bodySizeLimit,
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
); // Body parser for JSON
app.use(express.urlencoded({ extended: true, limit: bodySizeLimit })); // Body parser for forms
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } })); // HTTP request logging

/**
 * API Route Mounting
 */
app.use('/api', apiVersionMiddleware, routes);

/**
 * Global Error Handling
 * MUST be the last middleware mounted.
 */
app.use(errorHandler);

/**
 * Server Lifecycle Management
 */
const PORT = process.env.PORT || 3000;
let server;
const workers = [];
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info(`🚀 Stellarcade Backend is live on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Chain workers. A misconfigured worker throws here and stops startup:
  // running with it silently disabled would leave bets unresolved.
  if (process.env.ORACLE_ENABLED === 'true') {
    const { startOracleWorker } = require('./services/oracle.worker');
    workers.push(startOracleWorker());
  }
  if (process.env.INDEXER_ENABLED === 'true') {
    const { startIndexerWorker } = require('./services/indexer.worker');
    workers.push(startIndexerWorker());
  }
}

/**
 * Graceful Shutdown Logic
 */
const gracefulShutdown = async () => {
  logger.info('SIGTERM/SIGINT received. Starting graceful shutdown...');

  workers.forEach((worker) => worker.stop());

  // Close the server first to stop accepting new requests
  server.close(async () => {
    logger.info('HTTP server closed.');

    try {
      // Close database and redis connections
      await db.destroy();
      logger.info('Database connection closed.');

      // Redis client disconnect
      if (redis.client && redis.client.isOpen) {
        await redis.client.quit();
        logger.info('Redis connection closed.');
      }

      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = app;
