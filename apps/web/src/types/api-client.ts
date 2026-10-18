/**
 * Typed request/response contracts for the StellarCade backend REST API.
 *
 * All public endpoints are represented here as plain TypeScript interfaces.
 * The `ApiResult<T>` discriminated union is the canonical return type for
 * every `ApiClient` method — callers never need a try/catch.
 *
 * @module types/api-client
 */

import type { AppError } from './errors';

// ── Result envelope ─────────────────────────────────────────────────────────

/**
 * Discriminated union returned by every `ApiClient` method.
 * Mirrors the `ContractResult<T>` pattern used in `types/contracts.ts`.
 *
 * @example
 * ```typescript
 * const result = await client.getGames();
 * if (result.success) {
 *   console.log(result.data); // Game[]
 * } else {
 *   console.error(result.error.code); // ApiErrorCode
 * }
 * ```
 */
export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiClientError };

export const ApiErrorCategory = {
  VALIDATION: 'validation',
  NETWORK: 'network',
  AUTH: 'auth',
  SERVER: 'server',
  UNKNOWN: 'unknown',
} as const;

export type ApiErrorCategory =
  (typeof ApiErrorCategory)[keyof typeof ApiErrorCategory];

export interface ApiClientError extends AppError {
  category: ApiErrorCategory;
  status?: number;
  originalMessage?: string;
  /**
   * Machine-readable hint from the handler (e.g. `PROFILE_NOT_FOUND`,
   * `PROFILE_EXISTS`). Lets a caller distinguish conflicts that need
   * different recovery without string-matching the human message.
   */
  serverCode?: string;
}

/**
 * Options for a single API request.
 */
export interface ApiRequestOptions {
  /**
   * Optional AbortSignal to cancel the request.
   */
  signal?: AbortSignal;
  /**
   * Optional timeout in milliseconds.
   */
  timeout?: number;
}

// ── GET /api/games ───────────────────────────────────────────────────────────

/** A single game entry returned by the backend. */
export interface Game {
  id: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

/** Response shape for `GET /api/games`. */
export type GetGamesResponse = Game[];

/** Response shape for `GET /api/games/:gameId`. */
export type GetGameByIdResponse = Game | null;

// ── GET /api/users/profile ───────────────────────────────────────────────────

/** A user's on-chain profile. */
export interface UserProfile {
  address: string;
  username?: string;
  telegramHandle?: string;
  telegramUserId?: string;
  telegramLinked?: boolean;
  createdAt: string;
  updatedAt?: string;
  /**
   * ISO timestamp of the player's 18-or-over confirmation. Absent means the
   * player has not confirmed yet — treat that as "not onboarded", never as
   * an implicit yes.
   */
  ageConfirmedAt?: string;
}

/** Response shape for `GET /api/users/profile`. */
export type GetProfileResponse = UserProfile;

// ── POST /api/users/create ───────────────────────────────────────────────────

/** Request body for `POST /api/users/create`. */
export interface CreateProfileRequest {
  /** Stellar public key (G…). Must be a non-empty string. */
  address: string;
  username?: string;
  /**
   * The player ticked "I am 18 or over". The server records the timestamp;
   * it will reject creation without it.
   */
  ageConfirmed?: boolean;
}

/** Response shape for `POST /api/users/create`. */
export type CreateProfileResponse = UserProfile;

export interface UpdateProfileRequest {
  address: string;
  /**
   * Optional — the backend only touches fields actually supplied. Omit
   * this to sync Telegram-link fields alone without renaming the player;
   * required only when the caller actually intends to rename.
   */
  username?: string;
  /** Telegram bot linking — accepted by POST /api/users/update, which sets
   *  telegramLinked itself when a telegramUserId is supplied. */
  telegramHandle?: string;
  telegramUserId?: string;
  /**
   * Records the 18-or-over confirmation on a profile that predates the age
   * gate. The server only ever sets it, never clears it.
   */
  ageConfirmed?: boolean;
}

export type UpdateProfileResponse = UserProfile;

// ── POST /api/wallet/deposit & /api/wallet/withdraw ─────────────────────────

/** Request body for deposit/withdraw endpoints. Requires auth. */
export interface WalletAmountRequest {
  /** Amount in XLM. Must be greater than zero. */
  amount: number;
}

/** Response shape for wallet operations. */
export interface WalletOpResponse {
  balance: number;
  txHash?: string;
}

/** Response shape for `POST /api/wallet/deposit`. */
export type DepositResponse = WalletOpResponse;

/** Response shape for `POST /api/wallet/withdraw`. */
export type WithdrawResponse = WalletOpResponse;

// ── GET /api/wallet/:address/balance ────────────────────────────────────────

/** Response shape for `GET /api/wallet/:address/balance` — real on-chain
 * balances read from Horizon, keyed by asset code (XLM for native). */
export interface GetWalletBalanceResponse {
  address: string;
  balances: Record<string, string>;
}

// ── POST /api/auth/challenge & /api/auth/login ──────────────────────────────

/** Request body for `POST /api/auth/challenge`. */
export interface LoginChallengeRequest {
  address: string;
}

/** Response shape for `POST /api/auth/challenge`. */
export interface LoginChallengeResponse {
  challenge: string;
}

/** Request body for `POST /api/auth/login`. */
export interface LoginRequest {
  address: string;
  /** Base64-encoded Ed25519 signature over the challenge. */
  signature: string;
}

/** Response shape for `POST /api/auth/login`. */
export interface LoginResponse {
  token: string;
  profile: UserProfile;
}

// ── GET /api/games/recent ───────────────────────────────────────────────────

export interface RecentGameItem {
  id: number | string;
  user_id?: number | null;
  game_type: string;
  bet_amount: number | string;
  result: string;
  payout?: number | string;
  created_at: string;
  contract_id?: string | null;
  chain_game_id?: string | number | null;
  player_address?: string | null;
  user_wallet?: string | null;
  side?: string | null;
  status?: string | null;
  ledger?: number | null;
  resolve_tx_hash?: string | null;
  resolved_at?: string | null;
  server_seed?: string;
  commit_hash?: string;
  client_seed?: string;
  nonce?: number;
  [key: string]: unknown;
}

export interface RecentGamesResponse {
  items: RecentGameItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  pagination?: {
    nextCursor?: string | null;
    hasNextPage?: boolean;
  };
}

// ── GET /api/leaderboard ─────────────────────────────────────────────────────

export interface LeaderboardDto {
  rank: number;
  playerAddress: string;
  score: string;
}

