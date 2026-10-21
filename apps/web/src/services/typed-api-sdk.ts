import {
  ApiErrorCategory,
  type ApiClientError,
  type ApiRequestOptions,
  type ApiResult,
  type CreateProfileRequest,
  type CreateProfileResponse,
  type DepositResponse,
  type Game,
  type GetGameByIdResponse,
  type GetGamesResponse,
  type GetProfileResponse,
  type GetWalletBalanceResponse,
  type LeaderboardDto,
  type LoginChallengeRequest,
  type LoginChallengeResponse,
  type LoginRequest,
  type LoginResponse,
  type RecentGameItem,
  type RecentGamesResponse,
  type UpdateProfileRequest,
  type UpdateProfileResponse,
  type WalletAmountRequest,
  type WithdrawResponse,
} from "../types/api-client";
import { ErrorDomain, ErrorSeverity, type ApiErrorCode } from "../types/errors";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 300;

interface SessionStore {
  getToken(): string | null;
}

interface ApiClientConfig {
  baseUrl?: string;
  sessionStore?: SessionStore;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClientError(params: {
  code: ApiErrorCode;
  message: string;
  category: (typeof ApiErrorCategory)[keyof typeof ApiErrorCategory];
  severity: (typeof ErrorSeverity)[keyof typeof ErrorSeverity];
  status?: number;
  originalMessage?: string;
  serverCode?: string;
}): ApiClientError {
  return {
    code: params.code,
    message: params.message,
    category: params.category,
    severity: params.severity,
    domain: ErrorDomain.API,
    status: params.status,
    originalMessage: params.originalMessage,
    serverCode: params.serverCode,
  };
}

export const ONCHAIN_GAMES_CATALOG: Game[] = [
  {
    id: "coinflip-duel",
    name: "Coinflip Duel",
    status: "active",
    wager: 5,
    description:
      "Instant 50/50 provably fair on-chain duel. Double your stake on heads or tails.",
    contract: "coin-flip",
    players: 142,
    category: "PVP / Duel",
  },
  {
    id: "rng-dice",
    name: "Verifiable Dice Roll",
    status: "active",
    wager: 10,
    description:
      "Multi-sided dice arena backed by cryptographic seed commitments and Soroban RNG.",
    contract: "random-generator",
    players: 89,
    category: "Table / RNG",
  },
  {
    id: "prizepool-gauntlet",
    name: "Prize Pool Gauntlet",
    status: "active",
    wager: 25,
    description:
      "High-roller reserve pool with accumulated yields and on-chain payout splits.",
    contract: "prize-pool",
    players: 37,
    category: "Jackpot / Pool",
  },
];

function makeUnauthorizedError(): ApiClientError {
  return makeClientError({
    code: "API_UNAUTHORIZED",
    message: "Authentication required.",
    category: ApiErrorCategory.AUTH,
    severity: ErrorSeverity.TERMINAL,
    status: 401,
  });
}

function mapApiError(
  status: number,
  body: Record<string, unknown>,
): ApiClientError {
  const nestedError = (body.error ?? {}) as Record<string, unknown>;
  const message =
    // `{ "error": "Username already taken" }` — the shape the app's own route
    // handlers return. This case was missing, so every such response
    // collapsed to "Request failed with status 409" and the user was told
    // nothing about what to fix.
    (typeof body.error === "string" && body.error) ||
    (typeof nestedError.message === "string" && nestedError.message) ||
    (typeof body.message === "string" && body.message) ||
    `Request failed with status ${status}`;

  /** Machine-readable hint some handlers supply (e.g. PROFILE_EXISTS). */
  const serverCode =
    (typeof body.code === "string" && body.code) ||
    (typeof nestedError.code === "string" && nestedError.code) ||
    undefined;

  if (status === 400) {
    return makeClientError({
      code: "API_VALIDATION_ERROR",
      // Surface the specific validation problem rather than a bare
      // "Validation failed." — the caller renders this straight to the user.
      message,
      category: ApiErrorCategory.VALIDATION,
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status === 409) {
    return makeClientError({
      code: "API_CONFLICT",
      message,
      // Callers branch on this to tell "username taken" from "profile
      // already exists", which need different recovery.
      serverCode,
      category: ApiErrorCategory.VALIDATION,
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status === 401) {
    return makeClientError({
      code: "API_UNAUTHORIZED",
      message: "Authentication required.",
      category: ApiErrorCategory.AUTH,
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status === 403) {
    return makeClientError({
      code: "API_FORBIDDEN",
      message: "You are not allowed to perform this action.",
      category: ApiErrorCategory.AUTH,
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status === 404) {
    return makeClientError({
      code: "API_NOT_FOUND",
      message: "Requested resource was not found.",
      category: ApiErrorCategory.UNKNOWN,
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status === 429) {
    return makeClientError({
      code: "API_RATE_LIMITED",
      message: "Too many requests. Please try again.",
      category: ApiErrorCategory.SERVER,
      severity: ErrorSeverity.RETRYABLE,
      status,
      originalMessage: message,
    });
  }

  if (status === 501) {
    return makeClientError({
      code: "API_SERVER_ERROR",
      // The backend answers 501 WALLET_FLOW_DISABLED for the endpoints that
      // are not switched on yet, and its message names the flow, so keep it.
      message,
      category: ApiErrorCategory.SERVER,
      // A feature that is not implemented yet does not become implemented by
      // asking again.
      severity: ErrorSeverity.TERMINAL,
      status,
      originalMessage: message,
    });
  }

  if (status >= 500) {
    return makeClientError({
      code: "API_SERVER_ERROR",
      message: "Server error. Please try again.",
      category: ApiErrorCategory.SERVER,
      severity: ErrorSeverity.RETRYABLE,
      status,
      originalMessage: message,
    });
  }

  return makeClientError({
    code: "API_UNKNOWN",
    message,
    category: ApiErrorCategory.UNKNOWN,
    severity: ErrorSeverity.TERMINAL,
    status,
    originalMessage: message,
  });
}

function mapRpcError(err: unknown, timedOut: boolean): ApiClientError {
  if (timedOut) {
    return makeClientError({
      code: "API_REQUEST_TIMEOUT",
      message: "Request timed out.",
      category: ApiErrorCategory.NETWORK,
      severity: ErrorSeverity.TERMINAL,
      originalMessage: "Request timed out.",
    });
  }

  if (err instanceof DOMException && err.name === "AbortError") {
    return makeClientError({
      code: "API_ABORTED",
      message: "Request was cancelled.",
      category: ApiErrorCategory.NETWORK,
      severity: ErrorSeverity.TERMINAL,
      originalMessage: err.message,
    });
  }

  const message = err instanceof Error ? err.message : "Network error";
  return makeClientError({
    code: "API_NETWORK_ERROR",
    message: "Network request failed.",
    category: ApiErrorCategory.NETWORK,
    severity: ErrorSeverity.RETRYABLE,
    originalMessage: message,
  });
}

function dispatchApiTrace(_data: unknown): void {
  // no-op stub for local diagnostics hook
}

function makeValidationError(message: string): ApiClientError {
  return makeClientError({
    code: "API_VALIDATION_ERROR",
    message,
    category: ApiErrorCategory.VALIDATION,
    severity: ErrorSeverity.TERMINAL,
  });
}

/**
 * The backend's deposit and withdraw endpoints are switched off until a
 * verified on-chain settlement flow replaces them: they answer 501
 * `WALLET_FLOW_DISABLED` without reading or writing any balance. The web app
 * must not offer the action, so the client refuses here instead of sending a
 * request that is guaranteed to fail.
 */
function makeWalletFlowDisabledError(operation: string): ApiClientError {
  return makeClientError({
    code: "API_SERVER_ERROR",
    message: `${operation} is not available yet.`,
    category: ApiErrorCategory.SERVER,
    // Nothing about a disabled flow is fixed by trying again.
    severity: ErrorSeverity.TERMINAL,
    status: 501,
  });
}

/**
 * One on-chain game round as indexed by the backend's event indexer:
 * `GET /api/games/:contractId/:id`. Amounts are XLM units with 7 decimals,
 * `chain_game_id` is the on-chain u64 as a decimal string.
 */
export interface IndexedGameResponse {
  id?: number;
  user_id?: number | null;
  game_type: string;
  bet_amount: string;
  payout: string;
  result: string;
  status: string;
  contract_id: string;
  chain_game_id: string;
  player_address?: string | null;
  side?: string | null;
  ledger?: number | null;
  tx_hash?: string | null;
  resolve_tx_hash?: string | null;
  resolved_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export class ApiClient {
  private readonly _baseUrl: string;
  private readonly _sessionStore?: SessionStore;

  constructor();
  constructor(baseUrl: string, sessionStore?: SessionStore);
  constructor(config: ApiClientConfig);
  constructor(arg1?: string | ApiClientConfig, arg2?: SessionStore) {
    const envBaseUrl =
      (typeof process !== "undefined" &&
        (process.env.NEXT_PUBLIC_API_BASE_URL ||
          process.env.VITE_API_BASE_URL)) ||
      "";

    if (typeof arg1 === "string") {
      this._baseUrl = arg1 || envBaseUrl;
      this._sessionStore = arg2;
      return;
    }

    this._baseUrl = arg1?.baseUrl || envBaseUrl;
    this._sessionStore = arg1?.sessionStore;
  }

  async getGames(
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<GetGamesResponse>> {
    return this._request("GET", "/games", undefined, false, opts);
  }

  async getGameById(
    gameId: string,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<GetGameByIdResponse>> {
    if (!gameId.trim()) {
      return {
        success: false,
        error: makeValidationError("Game id is required."),
      };
    }
    return this._request(
      "GET",
      `/games/${encodeURIComponent(gameId)}`,
      undefined,
      false,
      opts,
    );
  }

  /**
   * Fetch one indexed on-chain round by contract id and on-chain game id.
   *
   * A 404 comes back as a failed result (`API_NOT_FOUND`, status 404): the
   * round simply isn't indexed yet, which callers must be able to tell apart
   * from an unavailable backend (network error / 5xx, retried and reported as
   * a network or server error).
   */
  async getIndexedGame(
    contractId: string,
    gameId: string,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<IndexedGameResponse>> {
    if (!contractId.trim() || !gameId.trim()) {
      return {
        success: false,
        error: makeValidationError("Contract id and game id are required."),
      };
    }
    return this._request(
      "GET",
      `/games/${encodeURIComponent(contractId)}/${encodeURIComponent(gameId)}`,
      undefined,
      false,
      opts,
    );
  }

  /**
   * Fetch the profile for one wallet address.
   *
   * The address is required and travels in the query string: the endpoint
   * scopes its lookup to that address alone, and previously — when called
   * without one — served whichever profile happened to be most recently
   * updated, handing one wallet another wallet's identity.
   *
   * A missing profile comes back as a failed result with status 404, which
   * is the normal signal that this wallet still needs onboarding.
   */
  async getProfile(
    address: string,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<GetProfileResponse>> {
    if (!address.trim()) {
      return {
        success: false,
        error: makeValidationError("A wallet address is required."),
      };
    }
    return this._request(
      "GET",
      `/users/profile?address=${encodeURIComponent(address)}`,
      undefined,
      true,
      opts,
    );
  }

  async createProfile(
    input: CreateProfileRequest,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<CreateProfileResponse>> {
    if (!input.address.trim()) {
      return {
        success: false,
        error: makeValidationError("Address is required."),
      };
    }
    return this._request("POST", "/users/create", input, false, opts);
  }

  async updateProfile(
    input: UpdateProfileRequest,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<UpdateProfileResponse>> {
    if (!input.address.trim()) {
      return {
        success: false,
        error: makeValidationError("Address is required."),
      };
    }
    // The backend route never enforces auth on this endpoint — requiring a
    // client-side token here just adds a failure mode the server doesn't
    // actually have (a Telegram-link sync silently dropped because login
    // hadn't completed yet, even though the update itself would've succeeded).
    return this._request("POST", "/users/update", input, false, opts);
  }

  async deposit(
    input: WalletAmountRequest,
    _opts?: ApiRequestOptions,
  ): Promise<ApiResult<DepositResponse>> {
    if (input.amount <= 0) {
      return {
        success: false,
        error: makeValidationError("Amount must be greater than zero."),
      };
    }
    return { success: false, error: makeWalletFlowDisabledError("Deposits") };
  }

  async withdraw(
    input: WalletAmountRequest,
    _opts?: ApiRequestOptions,
  ): Promise<ApiResult<WithdrawResponse>> {
    if (input.amount <= 0) {
      return {
        success: false,
        error: makeValidationError("Amount must be greater than zero."),
      };
    }
    return { success: false, error: makeWalletFlowDisabledError("Withdrawals") };
  }

  /** Real on-chain balances from Horizon — no linked account required. */
  async getWalletBalance(
    address: string,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<GetWalletBalanceResponse>> {
    if (!address.trim()) {
      return {
        success: false,
        error: makeValidationError("A wallet address is required."),
      };
    }
    return this._request(
      "GET",
      `/wallet/${encodeURIComponent(address)}/balance`,
      undefined,
      false,
      opts,
    );
  }

  /**
   * Fetch quest catalog and per-player progress from GET /quests?player=...
   */
  async getQuests(
    player?: string,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<QuestProgressDto[]>> {
    const query = player ? `?player=${encodeURIComponent(player)}` : "";
    return this._request("GET", `/quests${query}`, undefined, false, opts);
  }

  /**
   * Fetch recent games with optional player address, pagination, and game filter.
   */
  async getRecentGames(
    params?: {
      player?: string;
      page?: number;
      limit?: number;
      gameType?: string;
      status?: string;
      cursor?: string;
    },
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<RecentGamesResponse>> {
    const queryParts: string[] = [];
    if (params?.player) queryParts.push(`player=${encodeURIComponent(params.player)}`);
    if (params?.page) queryParts.push(`page=${encodeURIComponent(params.page)}`);
    if (params?.limit) queryParts.push(`limit=${encodeURIComponent(params.limit)}`);
    if (params?.gameType) queryParts.push(`gameType=${encodeURIComponent(params.gameType)}`);
    if (params?.status) queryParts.push(`status=${encodeURIComponent(params.status)}`);
    if (params?.cursor) queryParts.push(`cursor=${encodeURIComponent(params.cursor)}`);
    const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
    return this._request("GET", `/games/recent${qs}`, undefined, false, opts);
  }

  /**
   * Fetch top players ranked by total winnings from GET /leaderboard.
   */
  async getLeaderboard(
    params?: {
      game?: string;
      limit?: number;
    },
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<LeaderboardDto[]>> {
    const queryParts: string[] = [];
    if (params?.game) queryParts.push(`game=${encodeURIComponent(params.game)}`);
    if (params?.limit) queryParts.push(`limit=${encodeURIComponent(params.limit)}`);
    const qs = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
    return this._request("GET", `/leaderboard${qs}`, undefined, false, opts);
  }

  async createLoginChallenge(
    input: LoginChallengeRequest,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<LoginChallengeResponse>> {
    if (!input.address.trim()) {
      return {
        success: false,
        error: makeValidationError("Address is required."),
      };
    }
    return this._request("POST", "/auth/challenge", input, false, opts);
  }

  async login(
    input: LoginRequest,
    opts?: ApiRequestOptions,
  ): Promise<ApiResult<LoginResponse>> {
    if (!input.address.trim() || !input.signature.trim()) {
      return {
        success: false,
        error: makeValidationError("Address and signature are required."),
      };
    }
    return this._request("POST", "/auth/login", input, false, opts);
  }

  private async _request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    requiresAuth: boolean,
    opts: ApiRequestOptions = {},
  ): Promise<ApiResult<T>> {
    const token = this._sessionStore?.getToken() ?? null;

    if (requiresAuth && token === null) {
      return { success: false, error: makeUnauthorizedError() };
    }

    if (opts.signal?.aborted) {
      return {
        success: false,
        error: makeClientError({
          code: "API_ABORTED",
          message: "Request was cancelled.",
          category: ApiErrorCategory.NETWORK,
          severity: ErrorSeverity.TERMINAL,
          originalMessage: "Request was cancelled.",
        }),
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    let timedOut = false;

    const effectiveTimeout = opts.timeout ?? 5000;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, effectiveTimeout);

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        controller.abort(opts.signal?.reason);
      });
    }

    const url = `${this._baseUrl}${path}`;
    let lastError: ApiClientError | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
      }

      try {
        dispatchApiTrace({ method, path, attempt: attempt + 1 });

        const response = await fetch(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });

        if (response.ok) {
          const data = (await response.json()) as T;
          if (timeoutId) clearTimeout(timeoutId);
          return { success: true, data };
        }

        let errorBody: Record<string, unknown>;
        try {
          errorBody = (await response.json()) as Record<string, unknown>;
        } catch {
          errorBody = { status: response.status };
        }

        const mapped = mapApiError(response.status, errorBody);
        lastError = mapped;

        if (mapped.severity !== ErrorSeverity.RETRYABLE) {
          if (timeoutId) clearTimeout(timeoutId);
          return { success: false, error: mapped };
        }
      } catch (err: unknown) {
        const mapped = mapRpcError(err, timedOut);
        lastError = mapped;

        if (mapped.severity !== ErrorSeverity.RETRYABLE) {
          if (timeoutId) clearTimeout(timeoutId);
          return { success: false, error: mapped };
        }
      }
    }

    if (timeoutId) clearTimeout(timeoutId);
    return {
      success: false,
      error:
        lastError ??
        makeClientError({
          code: "API_UNKNOWN",
          message: "Unknown API error.",
          category: ApiErrorCategory.UNKNOWN,
          severity: ErrorSeverity.TERMINAL,
        }),
    };
  }
}

export interface QuestProgressDto {
  questId: string;
  progress: number;
  target: number;
  claimed: boolean;
  streak: number;
}

export type { ApiResult, ApiRequestOptions, ApiClientError };
export type { Game, RecentGamesResponse, RecentGameItem, LeaderboardDto };

