"use client";

import { useEffect, useRef, useState } from "react";
import {
  createCoinFlipRpc,
  findResolutionTxHash,
  getCoinFlipConfig,
  getGame,
  type CoinFlipGameState,
} from "../services/coin-flip-client";
import { ApiClient, type IndexedGameResponse } from "../services/typed-api-sdk";

export type CoinFlipGameStatus = "idle" | "pending" | "resolved" | "timeout" | "error";

export interface CoinFlipGameView {
  side: number;
  wager: bigint;
  won: boolean;
  payout: bigint;
  refunded?: boolean;
}

export interface UseCoinFlipGameResult {
  status: CoinFlipGameStatus;
  game?: CoinFlipGameView;
  /** Hash of the oracle-driven transaction that resolved the game. */
  resolveTxHash?: string | null;
  error?: string;
}

export interface UseCoinFlipGameOptions {
  /**
   * Reads the backend's indexed round (`GET /api/games/:contractId/:id`).
   * Resolves `null` when the round isn't indexed yet (404) and rejects when
   * the backend fails. Defaults to the configured API whenever
   * `NEXT_PUBLIC_API_BASE_URL` is set; without it, polling is RPC-only.
   */
  fetchIndexedGame?: (gameId: bigint) => Promise<IndexedGameResponse | null>;
  /** Reads `get_game`; defaults to a read-only simulation against Soroban RPC. */
  fetchGame?: (gameId: bigint) => Promise<CoinFlipGameState>;
  /** Looks up the resolving transaction; defaults to the `bet_resolved` event. */
  findResolveTx?: (gameId: bigint) => Promise<string | null>;
  pollIntervalMs?: number;
  /** After this long without a result, report `timeout` (polling continues). */
  timeoutMs?: number;
  /** Consecutive read failures tolerated before reporting `error`. */
  maxConsecutiveErrors?: number;
}

const POLL_INTERVAL_MS = 3_000;
const ORACLE_TIMEOUT_MS = 120_000;
const MAX_CONSECUTIVE_ERRORS = 5;
/** Backend poll backoff: 2s, then 3s, then 5s, capped. */
const BACKOFF_DELAYS_MS = [2_000, 3_000, 5_000];
/** After this long of consecutive 404s the round is treated as unindexed and polling moves to RPC. */
const INDEX_FALLBACK_MS = 10_000;

function defaultReaders() {
  const config = getCoinFlipConfig();
  const server = createCoinFlipRpc(config);
  return {
    fetchGame: (gameId: bigint) => getGame(server, config, gameId),
    findResolveTx: (gameId: bigint) => findResolutionTxHash(server, config, gameId),
  };
}

function apiBaseConfigured(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL),
  );
}

/**
 * Backend reader for the configured API. Returns `null` on 404 (not indexed
 * yet) and rejects on any other failure so the caller can fall back to RPC.
 * `null` when no backend is configured — polling then stays RPC-only.
 */
function createIndexedReader():
  | ((gameId: bigint) => Promise<IndexedGameResponse | null>)
  | null {
  if (!apiBaseConfigured()) return null;
  let contractId: string;
  try {
    contractId = getCoinFlipConfig().contractId;
  } catch {
    // Coin-flip itself is unconfigured; the RPC readers report that.
    return null;
  }
  const client = new ApiClient();
  return async (gameId: bigint) => {
    const result = await client.getIndexedGame(contractId, gameId.toString());
    if (result.success) return result.data;
    if (result.error?.status === 404) return null;
    throw new Error(result.error?.message ?? "Backend game lookup failed.");
  };
}

function toView(game: CoinFlipGameState): CoinFlipGameView {
  return {
    side: game.side,
    wager: game.wager,
    won: game.won,
    payout: game.payout,
    refunded: game.refunded,
  };
}

/** XLM units with 7 decimals ("1.9750000") → stroops. */
function unitsToStroops(units: string | number | null | undefined): bigint {
  if (units === null || units === undefined) return 0n;
  const [whole, fraction = ""] = String(units).split(".");
  const digits = `${whole || "0"}${fraction.padEnd(7, "0").slice(0, 7)}`;
  return BigInt(digits);
}

function toIndexedView(row: IndexedGameResponse): CoinFlipGameView {
  return {
    side: row.side === "tails" ? 1 : 0,
    wager: unitsToStroops(row.bet_amount),
    won: row.result === "win",
    payout: unitsToStroops(row.payout),
    refunded: undefined,
  };
}

/**
 * Follows a placed coin-flip game until the oracle resolves it. Polls the
 * backend's indexed rounds first — no RPC traffic after the bet's own
 * transaction — and falls back to the `get_game` simulation only while the
 * backend hasn't indexed the round (404 for ~10s) or when the backend fails.
 * Nothing is signed. A round that takes longer than the oracle timeout is
 * reported as `timeout` ("still waiting") while polling continues, rather
 * than as a failure.
 */
export function useCoinFlipGame(
  gameId: bigint | null,
  options: UseCoinFlipGameOptions = {},
): UseCoinFlipGameResult {
  const [state, setState] = useState<UseCoinFlipGameResult>({ status: "idle" });
  const {
    fetchIndexedGame,
    fetchGame,
    findResolveTx,
    pollIntervalMs = POLL_INTERVAL_MS,
    timeoutMs = ORACLE_TIMEOUT_MS,
    maxConsecutiveErrors = MAX_CONSECUTIVE_ERRORS,
  } = options;
  // Readers live in a ref so callers can pass inline functions without
  // restarting the poll loop on every render.
  const readersRef = useRef({ fetchIndexedGame, fetchGame, findResolveTx });
  readersRef.current = { fetchIndexedGame, fetchGame, findResolveTx };

  useEffect(() => {
    if (gameId === null) {
      setState((prev) => (prev.status === "idle" && !prev.game ? prev : { status: "idle" }));
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let consecutiveErrors = 0;

    const supplied = readersRef.current;
    let readers: {
      fetchGame: NonNullable<UseCoinFlipGameOptions["fetchGame"]>;
      findResolveTx: NonNullable<UseCoinFlipGameOptions["findResolveTx"]>;
    };
    try {
      const defaults = supplied.fetchGame && supplied.findResolveTx ? null : defaultReaders();
      readers = {
        fetchGame: supplied.fetchGame ?? defaults!.fetchGame,
        findResolveTx: supplied.findResolveTx ?? defaults!.findResolveTx,
      };
    } catch (error) {
      setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
      return;
    }

    // Backend-first when a reader exists (supplied or configured API);
    // otherwise poll the RPC simulation as before.
    const indexedReader: ((id: bigint) => Promise<IndexedGameResponse | null>) | null =
      supplied.fetchIndexedGame ?? createIndexedReader();
    const useBackend = indexedReader !== null;
    let backendAttempts = 0;
    let firstNotFoundAt: number | null = null;

    setState({ status: "pending" });

    const backendDelayMs = () =>
      BACKOFF_DELAYS_MS[Math.min(backendAttempts, BACKOFF_DELAYS_MS.length - 1)];

    const pollRpc = async () => {
      if (cancelled) return;
      try {
        const game = await readers.fetchGame(gameId);
        if (cancelled) return;
        consecutiveErrors = 0;
        if (game.resolved) {
          setState({ status: "resolved", game: toView(game) });
          const hash = await readers.findResolveTx(gameId).catch(() => null);
          if (!cancelled) setState({ status: "resolved", game: toView(game), resolveTxHash: hash });
          return; // resolved: stop polling
        }
        const waitedTooLong = Date.now() - startedAt >= timeoutMs;
        setState({ status: waitedTooLong ? "timeout" : "pending", game: toView(game) });
      } catch (error) {
        if (cancelled) return;
        consecutiveErrors += 1;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      timer = setTimeout(pollRpc, pollIntervalMs);
    };

    const pollBackend = async () => {
      if (cancelled) return;
      let row: IndexedGameResponse | null;
      try {
        row = await indexedReader!(gameId);
      } catch {
        // Backend unavailable: the RPC simulation answers from here on.
        if (cancelled) return;
        void pollRpc();
        return;
      }
      if (cancelled) return;

      if (row) {
        firstNotFoundAt = null;
        if (row.status === "resolved") {
          setState({
            status: "resolved",
            game: toIndexedView(row),
            resolveTxHash: row.resolve_tx_hash ?? null,
          });
          return; // resolved: stop polling
        }
        const waitedTooLong = Date.now() - startedAt >= timeoutMs;
        setState({
          status: waitedTooLong ? "timeout" : "pending",
          game: toIndexedView(row),
        });
      } else {
        if (firstNotFoundAt === null) firstNotFoundAt = Date.now();
        const waitedTooLong = Date.now() - startedAt >= timeoutMs;
        setState({ status: waitedTooLong ? "timeout" : "pending" });
        if (Date.now() - firstNotFoundAt >= INDEX_FALLBACK_MS) {
          // Long enough that the indexer should have caught up: stop waiting
          // on the backend and read the round from the contract directly.
          void pollRpc();
          return;
        }
      }

      const delayMs = backendDelayMs();
      backendAttempts += 1;
      timer = setTimeout(pollBackend, delayMs);
    };

    if (useBackend) {
      void pollBackend();
    } else {
      void pollRpc();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, pollIntervalMs, timeoutMs, maxConsecutiveErrors]);

  return state;
}
