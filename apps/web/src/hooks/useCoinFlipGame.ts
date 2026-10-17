"use client";

import { useEffect, useRef, useState } from "react";
import {
  createCoinFlipRpc,
  findResolutionTxHash,
  getCoinFlipConfig,
  getGame,
  type CoinFlipGameState,
} from "../services/coin-flip-client";

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
  /** Hash of the oracle-driven transaction that resolved the game, when RPC still has it. */
  resolveTxHash?: string | null;
  error?: string;
}

export interface UseCoinFlipGameOptions {
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

function defaultReaders() {
  const config = getCoinFlipConfig();
  const server = createCoinFlipRpc(config);
  return {
    fetchGame: (gameId: bigint) => getGame(server, config, gameId),
    findResolveTx: (gameId: bigint) => findResolutionTxHash(server, config, gameId),
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

/**
 * Follows a placed coin-flip game until the oracle resolves it. Polls
 * `get_game` by simulation only — nothing is signed. A round that takes longer
 * than the oracle timeout is reported as `timeout` ("still waiting") while
 * polling continues, rather than as a failure.
 */
export function useCoinFlipGame(
  gameId: bigint | null,
  options: UseCoinFlipGameOptions = {},
): UseCoinFlipGameResult {
  const [state, setState] = useState<UseCoinFlipGameResult>({ status: "idle" });
  const {
    fetchGame,
    findResolveTx,
    pollIntervalMs = POLL_INTERVAL_MS,
    timeoutMs = ORACLE_TIMEOUT_MS,
    maxConsecutiveErrors = MAX_CONSECUTIVE_ERRORS,
  } = options;
  // Readers live in a ref so callers can pass inline functions without
  // restarting the poll loop on every render.
  const readersRef = useRef({ fetchGame, findResolveTx });
  readersRef.current = { fetchGame, findResolveTx };

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

    setState({ status: "pending" });

    const poll = async () => {
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
          setState({ status: "error", error: error instanceof Error ? error.message : String(error) });
          return;
        }
      }
      timer = setTimeout(poll, pollIntervalMs);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, pollIntervalMs, timeoutMs, maxConsecutiveErrors]);

  return state;
}
