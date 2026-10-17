// Prevent Jest worker serialization failure on BigInt
if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

const StellarSdk = require('@stellar/stellar-sdk');

jest.mock('../../src/config/stellar', () => ({
  rpc: {
    simulateTransaction: jest.fn(),
    getAccount: jest.fn(),
    prepareTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
    getEvents: jest.fn(),
  },
  passphrase: 'Test SDF Network ; September 2015',
  network: 'testnet',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
}));

// Mock TransactionBuilder to return a serializable mock transaction without BigInt internals
const mockTx = {
  sign: jest.fn(),
  toXDR: () => 'AAAA_MOCK_TX_XDR==',
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  class MockTransactionBuilder {
    constructor() {}
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return mockTx;
    }
  }
  class MockAccount {
    constructor(accountId, sequence) {
      this._accountId = accountId;
      this._sequence = String(sequence);
    }
    accountId() {
      return this._accountId;
    }
    sequenceNumber() {
      return this._sequence;
    }
  }
  return {
    ...actual,
    TransactionBuilder: MockTransactionBuilder,
    Account: MockAccount,
    scValToNative: (val) => {
      if (val && typeof val === 'object' && val._val !== undefined) {
        return val._val;
      }
      return actual.scValToNative(val);
    },
  };
});

const sorobanService = require('../../src/services/soroban.service');
const { rpc } = require('../../src/config/stellar');

describe('SorobanService Unit Tests', () => {
  const dummyContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const dummyKeypair = StellarSdk.Keypair.random();

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('simulate', () => {
    it('decodes a mocked i128 / struct return value', async () => {
      const mockScVal = { _val: { balance: 15000000 } };
      rpc.simulateTransaction.mockResolvedValueOnce({
        result: {
          retval: mockScVal,
        },
      });

      const res = await sorobanService.simulate(dummyContractId, 'house_balance', []);
      expect(res).toEqual({ balance: 15000000 });
      expect(rpc.simulateTransaction).toHaveBeenCalled();
    });

    it('throws SorobanRpcError on simulation error with contract error code', async () => {
      rpc.simulateTransaction.mockResolvedValueOnce({
        error: {
          message: 'HostError: Error(Contract, #13)',
        },
      });

      await expect(sorobanService.simulate(dummyContractId, 'place_bet', [])).rejects.toMatchObject(
        {
          name: 'SorobanRpcError',
          contractErrorCode: 13,
        }
      );
    });
  });

  describe('invoke', () => {
    it('polls through NOT_FOUND to SUCCESS and returns transaction hash and return value', async () => {
      const accountMock = new StellarSdk.Account(dummyKeypair.publicKey(), '100');
      rpc.getAccount.mockResolvedValueOnce(accountMock);
      rpc.prepareTransaction.mockImplementationOnce(async (tx) => tx);
      rpc.sendTransaction.mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'mock_tx_hash_123',
      });

      // First poll returns NOT_FOUND, second returns SUCCESS
      rpc.getTransaction.mockResolvedValueOnce({ status: 'NOT_FOUND' }).mockResolvedValueOnce({
        status: 'SUCCESS',
        ledger: 12345,
        returnValue: { _val: 42 },
      });

      const result = await sorobanService.invoke(
        dummyContractId,
        'request_random',
        [],
        dummyKeypair,
        { timeoutMs: 3000, pollIntervalMs: 50 }
      );

      expect(result).toEqual({
        txHash: 'mock_tx_hash_123',
        returnValue: 42,
        ledger: 12345,
      });
      expect(rpc.getTransaction).toHaveBeenCalledTimes(2);
    });

    it('surfaces the contract error code when transaction status is FAILED', async () => {
      const accountMock = new StellarSdk.Account(dummyKeypair.publicKey(), '100');
      rpc.getAccount.mockResolvedValueOnce(accountMock);
      rpc.prepareTransaction.mockImplementationOnce(async (tx) => tx);
      rpc.sendTransaction.mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'mock_tx_fail_hash',
      });

      rpc.getTransaction.mockResolvedValueOnce({
        status: 'FAILED',
        resultXdr: 'HostError: Error(Contract, #10)',
      });

      await expect(
        sorobanService.invoke(dummyContractId, 'fulfill_random', [], dummyKeypair, {
          timeoutMs: 3000,
          pollIntervalMs: 50,
        })
      ).rejects.toMatchObject({
        name: 'SorobanRpcError',
        contractErrorCode: 10,
      });
    });

    it('rejects after timeout if status never becomes SUCCESS or FAILED', async () => {
      const accountMock = new StellarSdk.Account(dummyKeypair.publicKey(), '100');
      rpc.getAccount.mockResolvedValueOnce(accountMock);
      rpc.prepareTransaction.mockImplementationOnce(async (tx) => tx);
      rpc.sendTransaction.mockResolvedValueOnce({
        status: 'PENDING',
        hash: 'mock_tx_timeout_hash',
      });

      rpc.getTransaction.mockResolvedValue({ status: 'NOT_FOUND' });

      await expect(
        sorobanService.invoke(dummyContractId, 'place_bet', [], dummyKeypair, {
          timeoutMs: 150,
          pollIntervalMs: 50,
        })
      ).rejects.toMatchObject({
        name: 'SorobanRpcError',
        code: 'TIMEOUT',
      });
    });
  });

  describe('getEvents', () => {
    it('queries events and returns event array and cursor', async () => {
      rpc.getEvents.mockResolvedValueOnce({
        events: [{ id: '1', pagingToken: 'cursor-1' }],
        cursor: 'cursor-1',
      });

      const res = await sorobanService.getEvents({ contractIds: [dummyContractId] });
      expect(res.events).toHaveLength(1);
      expect(res.cursor).toBe('cursor-1');
    });
  });
});
