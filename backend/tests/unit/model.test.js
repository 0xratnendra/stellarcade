/**
 * Unit tests for model data operations.
 */
const mockLogger = {
  error: jest.fn(),
  info: jest.fn(),
};

const mockDb = jest.fn();
mockDb.raw = jest.fn().mockResolvedValue({});

jest.mock('../../src/config/database', () => mockDb);
jest.mock('../../src/utils/logger', () => mockLogger);

const GameModel = require('../../src/models/Game.model');
const TransactionModel = require('../../src/models/Transaction.model');

const createGameRecentBuilder = ({ items = [], total = 0 } = {}) => {
  const builder = {};
  builder.select = jest.fn().mockReturnValue(builder);
  builder.leftJoin = jest.fn().mockReturnValue(builder);
  builder.where = jest.fn().mockReturnValue(builder);
  builder.clone = jest.fn();
  builder.clearSelect = jest.fn().mockReturnValue(builder);
  builder.clearOrder = jest.fn().mockReturnValue(builder);
  builder.count = jest.fn().mockReturnValue(builder);
  builder.first = jest.fn().mockResolvedValue({ total });
  builder.orderBy = jest.fn().mockReturnValue(builder);
  builder.limit = jest.fn().mockReturnValue(builder);
  builder.offset = jest.fn().mockReturnValue(Promise.resolve(items));
  builder.then = (resolve, reject) => Promise.resolve(items).then(resolve, reject);
  builder.clone.mockImplementation(() => {
    const countBuilder = {
      clearSelect: jest.fn().mockReturnThis(),
      clearOrder: jest.fn().mockReturnThis(),
      count: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue({ total }),
    };
    return countBuilder;
  });
  return builder;
};

const createListBuilder = ({ items = [], total = 0 } = {}) => {
  const root = {};
  const countBuilder = {
    count: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue({ total }),
  };
  const itemsBuilder = {
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockResolvedValue(items),
  };

  root.where = jest.fn().mockReturnValue(root);
  root.clone = jest.fn().mockReturnValueOnce(countBuilder).mockReturnValueOnce(itemsBuilder);
  return root;
};

describe('Model operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GameModel', () => {
    test('create returns inserted game record', async () => {
      const inserted = [{ id: 10, game_type: 'coin-flip' }];
      const returning = jest.fn().mockResolvedValue(inserted);
      const insert = jest.fn().mockReturnValue({ returning });

      mockDb.mockImplementation((table) => {
        if (table === 'games') {
          return { insert };
        }
        return {};
      });

      const result = await GameModel.create({ user_id: 1, game_type: 'coin-flip' });

      expect(result).toEqual(inserted[0]);
      expect(insert).toHaveBeenCalledWith({ user_id: 1, game_type: 'coin-flip' });
      expect(returning).toHaveBeenCalledWith('*');
    });

    test('findById returns null when no row exists', async () => {
      const first = jest.fn().mockResolvedValue(undefined);
      const where = jest.fn().mockReturnValue({ first });

      mockDb.mockImplementation((table) => {
        if (table === 'games') {
          return { where };
        }
        return {};
      });

      const result = await GameModel.findById(999);
      expect(result).toBeNull();
      expect(where).toHaveBeenCalledWith({ id: 999 });
    });

    test('findRecent returns normalized metadata and items', async () => {
      const builder = createGameRecentBuilder({
        items: [{ id: 1 }, { id: 2 }],
        total: 5,
      });
      mockDb.mockImplementation(() => builder);

      const result = await GameModel.findRecent({
        page: 2,
        limit: 2,
        sortBy: 'bet_amount',
        sortDir: 'asc',
      });

      expect(result).toEqual({
        items: [{ id: 1 }, { id: 2 }],
        total: 5,
        page: 2,
        pageSize: 2,
      });
      // Left join keeps indexed games from wallets with no user account.
      expect(builder.leftJoin).toHaveBeenCalledWith('users', 'games.user_id', 'users.id');
      expect(builder.orderBy).toHaveBeenCalledWith('bet_amount', 'asc');
      expect(builder.limit).toHaveBeenCalledWith(2);
      expect(builder.offset).toHaveBeenCalledWith(2);
    });

    test('update logs and rethrows on failure', async () => {
      const error = new Error('write failed');
      const returning = jest.fn().mockRejectedValue(error);
      const update = jest.fn().mockReturnValue({ returning });
      const where = jest.fn().mockReturnValue({ update });

      mockDb.mockImplementation((table) => {
        if (table === 'games') {
          return { where };
        }
        return {};
      });

      await expect(GameModel.update(1, { result: 'win' })).rejects.toThrow('write failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Error in GameModel.update:', error);
    });
  });

  describe('TransactionModel', () => {
    test('create returns inserted transaction record', async () => {
      const inserted = [{ id: 77, status: 'pending' }];
      const returning = jest.fn().mockResolvedValue(inserted);
      const insert = jest.fn().mockReturnValue({ returning });

      mockDb.mockImplementation((table) => {
        if (table === 'transactions') {
          return { insert };
        }
        return {};
      });

      const result = await TransactionModel.create({ user_id: 1, amount: 10 });
      expect(result).toEqual(inserted[0]);
    });

    test('listByUser applies filters and pagination', async () => {
      const root = createListBuilder({
        items: [{ id: 1, type: 'deposit' }],
        total: 1,
      });
      mockDb.mockImplementation(() => root);

      const result = await TransactionModel.listByUser({
        userId: 3,
        page: 1,
        limit: 20,
        type: 'deposit',
        status: 'confirmed',
      });

      expect(result).toEqual({
        items: [{ id: 1, type: 'deposit' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(root.where).toHaveBeenNthCalledWith(1, { user_id: 3 });
      expect(root.where).toHaveBeenNthCalledWith(2, { type: 'deposit' });
      expect(root.where).toHaveBeenNthCalledWith(3, { status: 'confirmed' });
    });

    test('findById logs and rethrows on database failure', async () => {
      const error = new Error('db timeout');
      const first = jest.fn().mockRejectedValue(error);
      const where = jest.fn().mockReturnValue({ first });

      mockDb.mockImplementation((table) => {
        if (table === 'transactions') {
          return { where };
        }
        return {};
      });

      await expect(TransactionModel.findById(42)).rejects.toThrow('db timeout');
      expect(mockLogger.error).toHaveBeenCalledWith('Error in TransactionModel.findById:', error);
    });
  });
});
