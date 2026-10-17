const db = require('../config/database');
const { client: redisClient } = require('../config/redis');
const { server: horizonServer, rpc: sorobanRpc } = require('../config/stellar');
const sorobanService = require('./soroban.service');
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_ERROR_CODE = 'HEALTH_CHECK_TIMEOUT';
const GENERIC_FAILURE_TYPE = 'dependency_error';

const getElapsedMs = (startNs) => Number((process.hrtime.bigint() - startNs) / BigInt(1e6));

const createTimeoutError = (name, timeoutMs) => {
  const error = new Error(`${name} check timed out after ${timeoutMs}ms`);
  error.code = HEALTH_TIMEOUT_ERROR_CODE;
  return error;
};

const getFailureType = (error) =>
  error && error.code === HEALTH_TIMEOUT_ERROR_CODE ? 'timeout' : GENERIC_FAILURE_TYPE;

/**
 * Measure latency of an async check, returning stable status and latency fields.
 *
 * @param {string} name - dependency label (for logging)
 * @param {Function} checkFn - async function that performs the check
 * @param {number} timeoutMs - max time before the check is considered failed
 * @returns {Promise<{status: string, latency_ms: number, timeout_ms: number, timed_out: boolean, failure_type?: string, error?: string}>}
 */
const timedCheck = async (name, checkFn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const startNs = process.hrtime.bigint();
  let timeoutId;

  try {
    await Promise.race([
      checkFn(),
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(createTimeoutError(name, timeoutMs)), timeoutMs);
      }),
    ]);

    return {
      status: 'healthy',
      latency_ms: getElapsedMs(startNs),
      timeout_ms: timeoutMs,
      timed_out: false,
    };
  } catch (err) {
    logger.warn(`Health check failed for ${name}: ${err.message}`);

    return {
      status: 'unhealthy',
      latency_ms: getElapsedMs(startNs),
      timeout_ms: timeoutMs,
      timed_out: err.code === HEALTH_TIMEOUT_ERROR_CODE,
      failure_type: getFailureType(err),
      error: err.message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Check PostgreSQL connectivity by running a trivial query.
 */
const checkDatabase = (timeoutMs) => {
  return timedCheck(
    'db',
    async () => {
      await db.raw('SELECT 1');
    },
    timeoutMs
  );
};

/**
 * Check Redis connectivity via PING.
 */
const checkRedis = (timeoutMs) => {
  return timedCheck(
    'redis',
    async () => {
      const reply = await redisClient.ping();
      if (reply !== 'PONG') {
        throw new Error(`Unexpected PING reply: ${reply}`);
      }
    },
    timeoutMs
  );
};

/**
 * Check Stellar Horizon connectivity by fetching the root endpoint.
 */
const checkStellar = (timeoutMs) => {
  return timedCheck(
    'stellar',
    async () => {
      await horizonServer.root();
    },
    timeoutMs
  );
};

/**
 * Check Soroban RPC connectivity via getHealth() and getLatestLedger().
 */
const checkSoroban = (timeoutMs) => {
  return timedCheck(
    'soroban',
    async () => {
      if (typeof sorobanRpc.getHealth === 'function') {
        await sorobanRpc.getHealth();
      }
      if (typeof sorobanRpc.getLatestLedger === 'function') {
        await sorobanRpc.getLatestLedger();
      }
    },
    timeoutMs
  );
};

/**
 * Check reachability for configured contracts via lightweight simulated calls.
 * - coin-flip: house_exposure_snapshot
 * - random-generator: get_config
 *
 * Missing contract ID config shows as 'not_configured', never a crash.
 */
const checkContracts = async (timeoutMs) => {
  const coinFlipId = process.env.COIN_FLIP_CONTRACT_ID;
  const randomGenId = process.env.RANDOM_GENERATOR_CONTRACT_ID || process.env.RNG_CONTRACT_ID;

  const result = {
    coinFlip: { status: 'not_configured' },
    randomGenerator: { status: 'not_configured' },
  };

  const checks = [];

  if (coinFlipId) {
    checks.push(
      timedCheck(
        'contract:coinFlip',
        async () => {
          await sorobanService.simulate(coinFlipId, 'house_exposure_snapshot');
        },
        timeoutMs
      ).then((res) => {
        result.coinFlip = {
          status: res.status === 'healthy' ? 'ok' : 'error',
          ...(res.error ? { error: res.error } : {}),
        };
      })
    );
  }

  if (randomGenId) {
    checks.push(
      timedCheck(
        'contract:randomGenerator',
        async () => {
          await sorobanService.simulate(randomGenId, 'get_config');
        },
        timeoutMs
      ).then((res) => {
        result.randomGenerator = {
          status: res.status === 'healthy' ? 'ok' : 'error',
          ...(res.error ? { error: res.error } : {}),
        };
      })
    );
  }

  await Promise.all(checks);
  return result;
};

/**
 * Run all dependency health checks in parallel and return an aggregate result.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs] - per-check timeout in milliseconds
 * @returns {Promise<{status: string, timestamp: string, dependencies: Object, soroban: Object, contracts: Object}>}
 */
const deepHealthCheck = async (options = {}) => {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const [dbResult, redisResult, stellarResult, sorobanResult, contractsResult] = await Promise.all([
    checkDatabase(timeoutMs),
    checkRedis(timeoutMs),
    checkStellar(timeoutMs),
    checkSoroban(timeoutMs),
    checkContracts(timeoutMs),
  ]);

  const dependencies = {
    db: dbResult,
    redis: redisResult,
    stellar: stellarResult,
  };

  const soroban = {
    status: sorobanResult.status,
    latencyMs: sorobanResult.latency_ms,
    latency_ms: sorobanResult.latency_ms,
    timeout_ms: sorobanResult.timeout_ms,
    timed_out: sorobanResult.timed_out,
    ...(sorobanResult.error ? { error: sorobanResult.error } : {}),
    ...(sorobanResult.failure_type ? { failure_type: sorobanResult.failure_type } : {}),
  };

  const contractErrors = Object.values(contractsResult).some((c) => c.status === 'error');

  const statuses = Object.values(dependencies).map((d) => d.status);
  const coreUnhealthy = statuses.every((s) => s === 'unhealthy');
  const allHealthy =
    statuses.every((s) => s === 'healthy') && sorobanResult.status === 'healthy' && !contractErrors;

  let status;
  if (allHealthy) {
    status = 'healthy';
  } else if (coreUnhealthy) {
    status = 'unhealthy';
  } else {
    status = 'degraded';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    dependencies,
    soroban,
    contracts: contractsResult,
  };
};

module.exports = {
  deepHealthCheck,
  checkDatabase,
  checkRedis,
  checkStellar,
  checkSoroban,
  checkContracts,
};
