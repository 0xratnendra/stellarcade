const StellarSdk = require('@stellar/stellar-sdk');
const logger = require('./logger');

/**
 * Configure Stellar Server instance based on environment.
 */
const network = process.env.STELLAR_NETWORK || 'testnet';
const horizonUrl = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const isLikelyUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

if (!isLikelyUrl(horizonUrl)) {
  throw new Error('Invalid startup configuration: HORIZON_URL must be a valid http(s) URL');
}

/**
 * Resolve the network passphrase from env or derive from known network name.
 */
const resolvePassphrase = () => {
  if (process.env.NETWORK_PASSPHRASE) {
    return process.env.NETWORK_PASSPHRASE;
  }
  const passphraseMap = {
    testnet: StellarSdk.Networks.TESTNET,
    public: StellarSdk.Networks.PUBLIC,
    mainnet: StellarSdk.Networks.PUBLIC,
    futurenet: StellarSdk.Networks.FUTURENET,
    sandbox: StellarSdk.Networks.SANDBOX,
    standalone: StellarSdk.Networks.STANDALONE,
  };
  const resolved = passphraseMap[network.toLowerCase()];
  if (!resolved) {
    logger.warn(`Unknown STELLAR_NETWORK "${network}", defaulting to TESTNET passphrase`);
    return StellarSdk.Networks.TESTNET;
  }
  return resolved;
};

const passphrase = resolvePassphrase();

/**
 * Resilience configuration for Stellar requests.
 */
const requestTimeout = parseInt(process.env.STELLAR_REQUEST_TIMEOUT || '30000', 10);
const maxRetries = parseInt(process.env.STELLAR_MAX_RETRIES || '3', 10);
const retryInterval = parseInt(process.env.STELLAR_RETRY_INTERVAL || '1000', 10);

const server = new StellarSdk.Horizon.Server(horizonUrl, {
  opts: {
    timeout: requestTimeout,
  },
});

const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const rpc = new StellarSdk.rpc.Server(sorobanRpcUrl, {
  allowHttp: process.env.NODE_ENV !== 'production',
  timeout: requestTimeout,
});

logger.info(
  `Stellar SDK initialized for ${network} at ${horizonUrl} (rpc=${sorobanRpcUrl}, timeout=${requestTimeout}ms, maxRetries=${maxRetries})`
);

/**
 * Helper to get Contract Client (Skeleton - deprecated in favor of soroban.service)
 */
const getContractClient = (contractId) => {
  return {
    contractId,
    invoke: async (method, _args) => {
      logger.info(`Invoking ${method} on ${contractId}`);
      return { status: 'pending' };
    },
  };
};

module.exports = {
  server,
  rpc,
  network,
  passphrase,
  horizonUrl,
  sorobanRpcUrl,
  requestTimeout,
  maxRetries,
  retryInterval,
  getContractClient,
};
