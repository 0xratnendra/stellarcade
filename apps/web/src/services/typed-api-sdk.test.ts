// @vitest-environment node

/**
 * Unit tests for ApiClient (typed-api-sdk).
 *
 * All network calls are intercepted via `vi.fn()` on the global `fetch`.
 * No live HTTP — every response is a deterministic mock object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './typed-api-sdk';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): void {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): void {
  let mock = vi.fn();
  for (const r of responses) {
    mock = mock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response);
  }
  global.fetch = mock;
}

function mockFetchNetworkError(times = 1, successBody?: unknown): void {
  const mock = vi.fn();
  for (let i = 0; i < times; i++) {
    mock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  }
  if (successBody !== undefined) {
    mock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => successBody,
    } as Response);
  }
  global.fetch = mock;
}

function makeSessionStore(token: string | null = 'test-jwt-token') {
  return { getToken: () => token };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Happy path ───────────────────────────────────────────────────────────────

describe('ApiClient — happy path', () => {
  it('getGames returns typed game list', async () => {
    mockFetchNetworkError(0); // initialize global.fetch
    const games = [{ id: '1', name: 'Coin Flip', status: 'active' }];
    mockFetch(200, games);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(games);
    }
  });

  it('getProfile returns user profile', async () => {
    const profile = { address: 'GABC123', username: 'alice', createdAt: '2024-01-01' };
    mockFetch(200, profile);

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe('GABC123');
    }
  });

  it('createProfile returns created profile', async () => {
    const profile = { address: 'GABC123', createdAt: '2024-01-01' };
    mockFetch(200, profile);

    const client = new ApiClient();
    const result = await client.createProfile({ address: 'GABC123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe('GABC123');
    }
  });

  it('getWalletBalance returns real on-chain balances', async () => {
    mockFetch(200, { address: 'GABC123', balances: { XLM: '10000.0000000' } });

    const client = new ApiClient();
    const result = await client.getWalletBalance('GABC123');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.balances.XLM).toBe('10000.0000000');
    }
  });

  it('createLoginChallenge returns a challenge string', async () => {
    mockFetch(200, { challenge: 'Sign in to StellarCade\n\nNonce: abc123' });

    const client = new ApiClient();
    const result = await client.createLoginChallenge({ address: 'GABC123' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.challenge).toContain('Sign in to StellarCade');
    }
  });

  it('login returns a token and profile', async () => {
    mockFetch(200, { token: 'jwt-abc', profile: { address: 'GABC123', createdAt: '2024-01-01' } });

    const client = new ApiClient();
    const result = await client.login({ address: 'GABC123', signature: 'c2ln' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBe('jwt-abc');
      expect(result.data.profile.address).toBe('GABC123');
    }
  });

  it('deposit is not available yet and never reaches the API', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 5.0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/not available yet/i);
      expect(result.error.status).toBe(501);
      expect(result.error.severity).toBe('terminal');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('withdraw is not available yet and never reaches the API', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.withdraw({ amount: 5.0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/not available yet/i);
      expect(result.error.status).toBe(501);
      expect(result.error.severity).toBe('terminal');
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── Auth propagation ─────────────────────────────────────────────────────────

describe('ApiClient — auth propagation', () => {
  it('sends Authorization header when token is present', async () => {
    mockFetch(200, { success: true });
    const client = new ApiClient({ sessionStore: makeSessionStore('my-token') });
    await client.getProfile('GABC123');

    const calledHeaders = (global.fetch as any).mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBe('Bearer my-token');
  });

  it('returns API_UNAUTHORIZED immediately when token is missing for auth-required endpoint', async () => {
    const spy = vi.fn();
    global.fetch = spy;

    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
    // fetch must NOT have been called
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns API_UNAUTHORIZED when no sessionStore is provided for auth-required endpoint', async () => {
    const client = new ApiClient();
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
    }
  });

  it('does not send Authorization header when token is null for public endpoint', async () => {
    mockFetch(200, []);
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    await client.getGames();

    const calledHeaders = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });
});

// ── Retry logic ───────────────────────────────────────────────────────────────

describe('ApiClient — retry logic', () => {
  it('retries on 500 and succeeds on third attempt', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'server error' } },
      { status: 500, body: { message: 'server error' } },
      { status: 200, body: [{ id: '1', name: 'CoinFlip', status: 'active' }] },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('returns error after exhausting all retries on 500', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'error' } },
      { status: 500, body: { message: 'error' } },
      { status: 500, body: { message: 'error' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_SERVER_ERROR');
    }
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  }, 20_000);

  it('retries on network failure and succeeds', async () => {
    const successResponse = {
      ok: true,
      status: 200,
      json: async () => [{ id: '2', name: 'Pattern Puzzle', status: 'active' }],
    } as Response;

    global.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(successResponse);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
  }, 20_000);

  it('does NOT retry on 400 (terminal client error)', async () => {
    mockFetch(400, { message: 'bad request' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    mockFetch(401, { message: 'unauthorized' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});

// ── Error mapping ─────────────────────────────────────────────────────────────

describe('ApiClient — error mapping', () => {
  it('maps 400 → API_VALIDATION_ERROR', async () => {
    mockFetch(400, { error: { message: 'invalid input', status: 400 } });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
      expect(result.error.category).toBe('validation');
      expect(result.error.status).toBe(400);
      expect(result.error.originalMessage).toBe('invalid input');
    }
  });

  it('maps 401 → API_UNAUTHORIZED', async () => {
    mockFetch(401, { message: 'unauthorized' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNAUTHORIZED');
      expect(result.error.category).toBe('auth');
      expect(result.error.status).toBe(401);
    }
  });

  it('maps 403 → API_FORBIDDEN', async () => {
    mockFetch(403, { message: 'forbidden' });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_FORBIDDEN');
      expect(result.error.category).toBe('auth');
      expect(result.error.status).toBe(403);
    }
  });

  it('maps 501 → a terminal "not available yet" error, never a retry', async () => {
    mockFetch(501, {
      error: {
        message: 'Deposits are not available yet: the on-chain settlement flow is not enabled yet.',
        code: 'WALLET_FLOW_DISABLED',
        status: 501,
      },
    });

    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.status).toBe(501);
      expect(result.error.severity).toBe('terminal');
      expect(result.error.message).toMatch(/not available yet/i);
    }
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('maps 404 → API_NOT_FOUND', async () => {
    mockFetch(404, { message: 'not found' });

    const client = new ApiClient();
    const result = await client.createProfile({ address: 'GABC123' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_NOT_FOUND');
    }
  });

  it('maps 429 → API_RATE_LIMITED', async () => {
    // 429 is RETRYABLE so client will retry MAX_RETRIES times; supply enough responses.
    mockFetchSequence([
      { status: 429, body: { message: 'slow down' } },
      { status: 429, body: { message: 'slow down' } },
      { status: 429, body: { message: 'slow down' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_RATE_LIMITED');
    }
  }, 20_000);

  it('maps 500 → API_SERVER_ERROR (after retries exhausted)', async () => {
    mockFetchSequence([
      { status: 500, body: { message: 'crash' } },
      { status: 500, body: { message: 'crash' } },
      { status: 500, body: { message: 'crash' } },
    ]);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_SERVER_ERROR');
      expect(result.error.category).toBe('server');
      expect(result.error.status).toBe(500);
    }
  }, 20_000);

  it('maps network failures to the network category', async () => {
    mockFetchNetworkError(3);

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.category).toBe('network');
      expect(result.error.originalMessage).toBe('Failed to fetch');
    }
  }, 20_000);

  it('falls back to the unknown category for unclassified API responses', async () => {
    mockFetch(418, { message: 'teapot' });

    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_UNKNOWN');
      expect(result.error.category).toBe('unknown');
      expect(result.error.status).toBe(418);
      expect(result.error.originalMessage).toBe('teapot');
    }
  });
});

// ── Cancellation and Timeout ─────────────────────────────────────────────────

describe('ApiClient — cancellation and timeout', () => {
  it('aborts request when signal is cancelled', async () => {
    const controller = new AbortController();
    const client = new ApiClient();

    // Mock fetch to simulate abort
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        if (init.signal?.aborted) {
          return reject(new DOMException('The user aborted a request.', 'AbortError'));
        }
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const promise = client.getGames({ signal: controller.signal });
    controller.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_ABORTED');
      expect(result.error.message).toContain('cancelled');
    }
  });

  it('times out request when timeout is reached', async () => {
    vi.useFakeTimers();
    const client = new ApiClient();

    try {
      global.fetch = vi.fn().mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          if (init.signal?.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
          }
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const promise = client.getGames({ timeout: 1000 });

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1100);

      const result = await promise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('API_REQUEST_TIMEOUT');
        expect(result.error.message).toContain('timed out');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new ApiClient();

    const result = await client.getGames({ signal: controller.signal });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_ABORTED');
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('ApiClient — input validation', () => {
  it('no longer exposes playGame (the off-chain /games/play simulator was removed)', () => {
    const client = new ApiClient();
    expect('playGame' in client).toBe(false);
  });

  it('rejects createProfile with empty address', async () => {
    const client = new ApiClient();
    const result = await client.createProfile({ address: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects deposit with zero amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects deposit with negative amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.deposit({ amount: -1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });

  it('rejects withdraw with zero amount', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore() });
    const result = await client.withdraw({ amount: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }
  });
});

// ── Result envelope shape ─────────────────────────────────────────────────────

describe('ApiClient — result envelope shape', () => {
  it('success result has { success: true, data } and no error property', async () => {
    mockFetch(200, []);
    const client = new ApiClient();
    const result = await client.getGames();

    expect(result.success).toBe(true);
    expect('data' in result).toBe(true);
    expect('error' in result).toBe(false);
  });

  it('failure result has { success: false, error } and no data property', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    expect('error' in result).toBe(true);
    expect('data' in result).toBe(false);
  });

  it('error contains code, domain, severity, message fields', async () => {
    const client = new ApiClient({ sessionStore: makeSessionStore(null) });
    const result = await client.getProfile('GABC123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error.code).toBe('string');
      expect(typeof result.error.domain).toBe('string');
      expect(typeof result.error.severity).toBe('string');
      expect(typeof result.error.message).toBe('string');
    }
  });

  it('getRecentGames queries /games/recent with player and pagination', async () => {
    const mockData = {
      items: [{ id: 1, game_type: 'coin-flip', bet_amount: 10, result: 'win' }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    };
    mockFetch(200, mockData);

    const client = new ApiClient();
    const result = await client.getRecentGames({ player: 'GALICE123', page: 1, limit: 10 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0].id).toBe(1);
    }
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/games/recent?player=GALICE123&page=1&limit=10'),
      expect.anything()
    );
  });

  it('getLeaderboard queries /leaderboard with game and limit', async () => {
    const mockData = [
      { rank: 1, playerAddress: 'GALICE123', score: '500' },
      { rank: 2, playerAddress: 'GBOB456', score: '300' },
    ];
    mockFetch(200, mockData);

    const client = new ApiClient();
    const result = await client.getLeaderboard({ game: 'coin-flip', limit: 25 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].playerAddress).toBe('GALICE123');
    }
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/leaderboard?game=coin-flip&limit=25'),
      expect.anything()
    );
  });
});


describe('ApiClient — indexed game lookup', () => {
  const CONTRACT_ID = 'CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ';
  const indexedRow = {
    game_type: 'coinflip',
    bet_amount: '1.0000000',
    payout: '0.0000000',
    result: 'pending',
    status: 'pending',
    contract_id: CONTRACT_ID,
    chain_game_id: '424242',
    side: 'heads',
    resolve_tx_hash: null,
  };

  it('getIndexedGame fetches /games/:contractId/:id', async () => {
    mockFetch(200, indexedRow);

    const client = new ApiClient();
    const result = await client.getIndexedGame(CONTRACT_ID, '424242');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chain_game_id).toBe('424242');
      expect(result.data.status).toBe('pending');
    }
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/games/${CONTRACT_ID}/424242`),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('getIndexedGame reports a 404 as API_NOT_FOUND with status 404, without retrying', async () => {
    mockFetch(404, { status: 404, message: 'No indexed game matches this contract and game id.' });

    const client = new ApiClient();
    const result = await client.getIndexedGame(CONTRACT_ID, '999999');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('API_NOT_FOUND');
      expect(result.error.status).toBe(404);
      expect(result.error.severity).toBe('terminal');
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('getIndexedGame validates the ids without hitting the API', async () => {
    const spy = vi.fn();
    global.fetch = spy;
    const client = new ApiClient();

    for (const [contractId, gameId] of [
      ['', '1'],
      [CONTRACT_ID, '  '],
    ]) {
      const result = await client.getIndexedGame(contractId, gameId);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('API_VALIDATION_ERROR');
    }

    expect(spy).not.toHaveBeenCalled();
  });
});
