/**
 * Stellarcade domain error catalog.
 *
 * Two complementary error systems co-exist in this file:
 *
 * 1. `AppError` / `ErrorDomain` / `ErrorSeverity` — generic structured error
 *    catalog used by global state, error mapping, and telemetry pipelines.
 *
 * 2. `SorobanErrorCode` / `SorobanClientError` — typed errors thrown by
 *    `SorobanContractClient`.  All public client methods return
 *    `ContractResult<T>`, which wraps these errors in a discriminated union so
 *    callers never need a try/catch.
 */

// ---------------------------------------------------------------------------
// Part 1 — Generic AppError catalog (global state / error-mapping service)
// ---------------------------------------------------------------------------

export const ErrorDomain = {
  RPC:      'rpc',
  API:      'api',
  WALLET:   'wallet',
  CONTRACT: 'contract',
  UI:       'ui',
  UNKNOWN:  'unknown',
} as const;

export type ErrorDomain = (typeof ErrorDomain)[keyof typeof ErrorDomain];

export const ErrorSeverity = {
  /** Transient failure — caller may retry after a delay. */
  RETRYABLE: 'retryable',
  /** User must take an explicit action (connect wallet, switch network, etc.). */
  USER_ACTIONABLE: 'user_actionable',
  /** Non-recoverable — no retry or user action will resolve it. */
  TERMINAL: 'terminal',
  FATAL: 'fatal',
} as const;

export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

export type RpcErrorCode =
  | 'RPC_NODE_UNAVAILABLE'
  | 'RPC_CONNECTION_TIMEOUT'
  | 'RPC_SIMULATION_FAILED'
  | 'RPC_TX_REJECTED'
  | 'RPC_TX_EXPIRED'
  | 'RPC_RESOURCE_LIMIT_EXCEEDED'
  | 'RPC_INVALID_RESPONSE'
  | 'RPC_UNKNOWN';

export type ApiErrorCode =
  | 'API_NETWORK_ERROR'
  | 'API_UNAUTHORIZED'
  | 'API_FORBIDDEN'
  | 'API_NOT_FOUND'
  | 'API_VALIDATION_ERROR'
  /** 409 — the request conflicts with existing state (username already
      taken, profile already exists for this address, …). */
  | 'API_CONFLICT'
  | 'API_RATE_LIMITED'
  | 'API_SERVER_ERROR'
  | 'API_REQUEST_TIMEOUT'
  | 'API_ABORTED'
  | 'API_UNKNOWN';

export type WalletErrorCode =
  | 'WALLET_NOT_INSTALLED'
  | 'WALLET_NOT_CONNECTED'
  | 'WALLET_USER_REJECTED'
  | 'WALLET_NETWORK_MISMATCH'
  | 'WALLET_INSUFFICIENT_BALANCE'
  | 'WALLET_SIGN_FAILED'
  | 'WALLET_UNKNOWN';

/**
 * Contract error codes cover all numeric variants across deployed Stellarcade
 * contracts. Codes are disambiguated by ContractName before mapping.
 */
export type ContractErrorCode =
  | 'CONTRACT_ALREADY_INITIALIZED'
  | 'CONTRACT_NOT_INITIALIZED'
  | 'CONTRACT_NOT_AUTHORIZED'
  | 'CONTRACT_INVALID_AMOUNT'
  | 'CONTRACT_INSUFFICIENT_FUNDS'
  | 'CONTRACT_GAME_ALREADY_RESERVED'
  | 'CONTRACT_RESERVATION_NOT_FOUND'
  | 'CONTRACT_PAYOUT_EXCEEDS_RESERVATION'
  | 'CONTRACT_OVERFLOW'
  | 'CONTRACT_INVALID_BOUND'
  | 'CONTRACT_DUPLICATE_REQUEST_ID'
  | 'CONTRACT_REQUEST_NOT_FOUND'
  | 'CONTRACT_ALREADY_FULFILLED'
  | 'CONTRACT_UNAUTHORIZED_CALLER'
  | 'CONTRACT_INVALID_SIDE'
  | 'CONTRACT_GAME_ALREADY_EXISTS'
  | 'CONTRACT_GAME_NOT_FOUND'
  | 'CONTRACT_GAME_ALREADY_RESOLVED'
  | 'CONTRACT_RNG_NOT_FULFILLED'
  | 'CONTRACT_WAGER_TOO_LOW'
  | 'CONTRACT_WAGER_TOO_HIGH'
  | 'CONTRACT_INSUFFICIENT_HOUSE_LIQUIDITY'
  | 'CONTRACT_REFUND_NOT_YET_AVAILABLE'
  | 'CONTRACT_GAME_REFUNDED'
  | 'CONTRACT_UNKNOWN';

export type UiErrorCode =
  | 'CLIPBOARD_NOT_SUPPORTED'
  | 'CLIPBOARD_ERROR'
  | 'UI_UNKNOWN';

export type AppErrorCode =
  | RpcErrorCode
  | ApiErrorCode
  | WalletErrorCode
  | ContractErrorCode
  | UiErrorCode
  | 'UNKNOWN';

export interface AppError {
  /** Structured code for programmatic branching - never parse `message` for logic. */
  code: AppErrorCode;
  domain: ErrorDomain;
  severity: ErrorSeverity;
  /**
   * Human-readable description intended for developer tooling and logs.
   * Do NOT render this string directly in user-facing UI without sanitisation.
   */
  message: string;
  /** The raw error that was mapped, preserved for debugging and logging. */
  originalError?: unknown;
  /** Caller-provided enrichment (e.g. gameId, requestId, walletAddress). */
  context?: Record<string, unknown>;
  /** For RETRYABLE errors: suggested minimum wait before retrying (ms). */
  retryAfterMs?: number;
  /** Structured API error details for support/QA workflows. */
  apiDetails?: ApiErrorDetails;
  /** UI action associated with the error (e.g., 'Please try again') */
  action?: string;
  /** Diagnostic debug properties */
  debug?: {
    originalError?: unknown;
    context?: Record<string, unknown>;
    retryAfterMs?: number;
  };
}

/** Structured error details returned by backend API responses. */
export interface ApiErrorDetails {
  /** Backend error code (e.g. "VALIDATION_FAILED", "RATE_LIMITED"). */
  errorCode?: string;
  /** Correlation/request ID for support tracing. */
  requestId?: string;
  /** Per-field validation errors. */
  fieldErrors?: Array<{ field: string; message: string }>;
}

export type ErrorMappingHint = ErrorDomain;

/**
 * Named identifiers for each deployed Stellarcade Soroban contract.
 * Required by mapContractError() to disambiguate shared numeric error slots.
 */
export const ContractName = {
  PRIZE_POOL:        'prize_pool',
  RANDOM_GENERATOR:  'random_generator',
  ACCESS_CONTROL:    'access_control',
  PATTERN_PUZZLE:    'pattern_puzzle',
  COIN_FLIP:         'coin_flip',
} as const;

export type ContractName = (typeof ContractName)[keyof typeof ContractName];

export interface TelemetryEvent {
  errorCode: AppErrorCode;
  domain: ErrorDomain;
  severity: ErrorSeverity;
  message: string;
  timestamp: number;
  correlationId?: string;
  userId?: string;
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Part 2 — SorobanClientError (used by SorobanContractClient)
// ---------------------------------------------------------------------------

export enum SorobanErrorCode {
  // ── Network / RPC ──────────────────────────────────────────────────────
  NetworkError = "NETWORK_ERROR",
  RpcError = "RPC_ERROR",
  SimulationFailed = "SIMULATION_FAILED",
  TransactionFailed = "TX_FAILED",

  // ── Wallet ─────────────────────────────────────────────────────────────
  WalletNotConnected = "WALLET_NOT_CONNECTED",
  NetworkMismatch = "NETWORK_MISMATCH",
  UserRejected = "USER_REJECTED",

  // ── Contract ───────────────────────────────────────────────────────────
  ContractError = "CONTRACT_ERROR",

  // ── Validation ─────────────────────────────────────────────────────────
  InvalidParameter = "INVALID_PARAMETER",
  ContractAddressNotFound = "CONTRACT_ADDRESS_NOT_FOUND",

  // ── Retry ──────────────────────────────────────────────────────────────
  RetryExhausted = "RETRY_EXHAUSTED",
}

export const AchievementBadgeErrors: Record<number, string> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "NotAuthorized",
  4: "BadgeNotFound",
  5: "BadgeAlreadyExists",
  6: "BadgeAlreadyAwarded",
  7: "InvalidInput",
};

export const PrizePoolErrors: Record<number, string> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "NotAuthorized",
  4: "InvalidAmount",
  5: "InsufficientFunds",
  6: "GameAlreadyReserved",
  7: "ReservationNotFound",
  8: "PayoutExceedsReservation",
  9: "Overflow",
};

export class SorobanClientError extends Error {
  readonly code: SorobanErrorCode;
  readonly retryable: boolean;
  readonly contractErrorCode?: number;
  readonly originalError?: unknown;

  constructor(opts: {
    code: SorobanErrorCode;
    message: string;
    retryable?: boolean;
    contractErrorCode?: number;
    originalError?: unknown;
  }) {
    super(opts.message);
    this.name = "SorobanClientError";
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.contractErrorCode = opts.contractErrorCode;
    this.originalError = opts.originalError;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static walletNotConnected(): SorobanClientError {
    return new SorobanClientError({
      code: SorobanErrorCode.WalletNotConnected,
      message: "No wallet is connected. Connect a wallet before signing transactions.",
      retryable: false,
    });
  }

  static networkMismatch(expected: string, actual: string): SorobanClientError {
    return new SorobanClientError({
      code: SorobanErrorCode.NetworkMismatch,
      message: `Wallet is on network "${actual}" but client expects "${expected}".`,
      retryable: false,
    });
  }

  static invalidParam(paramName: string, reason: string): SorobanClientError {
    return new SorobanClientError({
      code: SorobanErrorCode.InvalidParameter,
      message: `Invalid parameter "${paramName}": ${reason}`,
      retryable: false,
    });
  }

  static addressNotFound(contractName: string): SorobanClientError {
    return new SorobanClientError({
      code: SorobanErrorCode.ContractAddressNotFound,
      message: `Contract address for "${contractName}" is not set in the registry.`,
      retryable: false,
    });
  }

  static userRejected(): SorobanClientError {
    return new SorobanClientError({
      code: SorobanErrorCode.UserRejected,
      message: "Transaction was rejected by the user.",
      retryable: false,
    });
  }
}
