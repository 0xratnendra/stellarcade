import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCoinFlipGame } from "./useCoinFlipGame";
import type { CoinFlipGameState } from "../services/coin-flip-client";
import { ApiClient } from "../services/typed-api-sdk";

const unresolved: CoinFlipGameState = {
  player: "G...",
  side: 0,
  wager: 10_000_000n,
  resolved: false,
  won: false,
  payout: 0n,
};
const resolvedWin: CoinFlipGameState = { ...unresolved, resolved: true, won: true, payout: 19_750_000n };

const CONTRACT_ID = "CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ";
const indexedPending = {
  game_type: "coinflip",
  bet_amount: "1.0000000",
  payout: "0.0000000",
  result: "pending",
  status: "pending",
  contract_id: CONTRACT_ID,
  chain_game_id: "424242",
  side: "heads",
  resolve_tx_hash: null,
};
const indexedResolved = {
  ...indexedPending,
  result: "win",
  status: "resolved",
  payout: "1.9750000",
  resolve_tx_hash: "b".repeat(64),
};

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useCoinFlipGame", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays idle without a game id", () => {
    const fetchGame = vi.fn();
    const { result } = renderHook(() =>
      useCoinFlipGame(null, { fetchGame, findResolveTx: vi.fn() }),
    );
    expect(result.current.status).toBe("idle");
    expect(fetchGame).not.toHaveBeenCalled();
  });

  it("polls about every 3s and stops once the game is resolved", async () => {
    const fetchGame = vi
      .fn()
      .mockResolvedValueOnce(unresolved)
      .mockResolvedValueOnce(unresolved)
      .mockResolvedValue(resolvedWin);
    const findResolveTx = vi.fn().mockResolvedValue("b".repeat(64));
    const options = { fetchGame, findResolveTx };

    const { result } = renderHook(() => useCoinFlipGame(42n, options));
    await advance(0);
    expect(result.current.status).toBe("pending");
    expect(fetchGame).toHaveBeenCalledWith(42n);

    await advance(3_000);
    await advance(3_000);
    expect(result.current.status).toBe("resolved");
    expect(result.current.game).toEqual({
      side: 0,
      wager: 10_000_000n,
      won: true,
      payout: 19_750_000n,
      refunded: undefined,
    });
    expect(result.current.resolveTxHash).toBe("b".repeat(64));

    const callsAtResolution = fetchGame.mock.calls.length;
    await advance(30_000);
    expect(fetchGame).toHaveBeenCalledTimes(callsAtResolution);
  });

  it("reports timeout after the oracle limit but keeps polling", async () => {
    const fetchGame = vi.fn().mockResolvedValue(unresolved);
    const options = { fetchGame, findResolveTx: vi.fn(), timeoutMs: 120_000 };

    const { result } = renderHook(() => useCoinFlipGame(7n, options));
    await advance(0);
    await advance(114_000);
    expect(result.current.status).toBe("pending");

    await advance(6_000);
    expect(result.current.status).toBe("timeout");

    fetchGame.mockResolvedValue(resolvedWin);
    await advance(3_000);
    expect(result.current.status).toBe("resolved");
  });

  it("tolerates transient read failures, then reports an error", async () => {
    const fetchGame = vi.fn().mockRejectedValue(new Error("rpc down"));
    const options = { fetchGame, findResolveTx: vi.fn(), maxConsecutiveErrors: 3 };

    const { result } = renderHook(() => useCoinFlipGame(1n, options));
    await advance(0);
    await advance(3_000);
    expect(result.current.status).toBe("pending");
    await advance(3_000);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("rpc down");

    await advance(30_000);
    expect(fetchGame).toHaveBeenCalledTimes(3);
  });

  it("shows a resolved game without a resolution link when RPC no longer has the event", async () => {
    const options = {
      fetchGame: vi.fn().mockResolvedValue(resolvedWin),
      findResolveTx: vi.fn().mockRejectedValue(new Error("startLedger out of range")),
    };
    const { result } = renderHook(() => useCoinFlipGame(9n, options));
    await advance(0);
    expect(result.current.status).toBe("resolved");
    expect(result.current.resolveTxHash).toBeNull();
  });

  it("resolves from the backend's indexed row without any RPC call", async () => {
    const fetchIndexedGame = vi.fn().mockResolvedValue(indexedResolved);
    const fetchGame = vi.fn();
    const findResolveTx = vi.fn();

    const { result } = renderHook(() =>
      useCoinFlipGame(42n, { fetchIndexedGame, fetchGame, findResolveTx }),
    );
    await advance(0);

    expect(result.current.status).toBe("resolved");
    expect(result.current.game).toEqual({
      side: 0,
      wager: 10_000_000n,
      won: true,
      payout: 19_750_000n,
      refunded: undefined,
    });
    expect(result.current.resolveTxHash).toBe("b".repeat(64));
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).not.toHaveBeenCalled();
    expect(findResolveTx).not.toHaveBeenCalled();

    await advance(60_000);
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).not.toHaveBeenCalled();
  });

  it("keeps polling the backend with backoff while the round is not indexed, then resolves", async () => {
    const fetchIndexedGame = vi
      .fn()
      .mockResolvedValueOnce(null) // t=0: 404, not indexed yet
      .mockResolvedValueOnce(null) // t=2s
      .mockResolvedValueOnce(indexedPending) // t=5s
      .mockResolvedValue(indexedResolved); // t=10s
    const fetchGame = vi.fn();

    const { result } = renderHook(() =>
      useCoinFlipGame(42n, { fetchIndexedGame, fetchGame, findResolveTx: vi.fn() }),
    );
    await advance(0);
    expect(result.current.status).toBe("pending");
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).not.toHaveBeenCalled();

    await advance(1_999);
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    await advance(1); // first backoff step: 2s
    expect(fetchIndexedGame).toHaveBeenCalledTimes(2);

    await advance(3_000); // second backoff step: 3s (t = 5s)
    expect(fetchIndexedGame).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("pending");
    expect(result.current.game?.wager).toBe(10_000_000n);

    await advance(5_000); // third backoff step: 5s (t = 10s)
    expect(result.current.status).toBe("resolved");
    expect(result.current.resolveTxHash).toBe("b".repeat(64));
    expect(fetchGame).not.toHaveBeenCalled();
  });

  it("falls back to the RPC simulation once the backend keeps answering 404", async () => {
    const fetchIndexedGame = vi.fn().mockResolvedValue(null);
    const fetchGame = vi
      .fn()
      .mockResolvedValueOnce(unresolved)
      .mockResolvedValue(resolvedWin);
    const findResolveTx = vi.fn().mockResolvedValue("c".repeat(64));

    const { result } = renderHook(() =>
      useCoinFlipGame(42n, { fetchIndexedGame, fetchGame, findResolveTx }),
    );
    await advance(0); // t=0 → 404
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).not.toHaveBeenCalled();

    await advance(2_000); // t=2s → 404
    await advance(3_000); // t=5s → 404
    expect(fetchIndexedGame).toHaveBeenCalledTimes(3);
    expect(fetchGame).not.toHaveBeenCalled();

    await advance(5_000); // t=10s → 404 for ~10s: switch to the contract
    expect(fetchIndexedGame).toHaveBeenCalledTimes(4);
    expect(fetchGame).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("pending");

    await advance(3_000); // RPC cadence
    expect(result.current.status).toBe("resolved");
    expect(result.current.resolveTxHash).toBe("c".repeat(64));
    expect(fetchIndexedGame).toHaveBeenCalledTimes(4);

    await advance(30_000);
    expect(fetchIndexedGame).toHaveBeenCalledTimes(4);
    expect(fetchGame).toHaveBeenCalledTimes(2);
  });

  it("falls back to the RPC simulation when the backend fails", async () => {
    const fetchIndexedGame = vi.fn().mockRejectedValue(new Error("backend down"));
    const fetchGame = vi.fn().mockResolvedValue(resolvedWin);
    const findResolveTx = vi.fn().mockResolvedValue("d".repeat(64));

    const { result } = renderHook(() =>
      useCoinFlipGame(42n, { fetchIndexedGame, fetchGame, findResolveTx }),
    );
    await advance(0);

    expect(result.current.status).toBe("resolved");
    expect(result.current.resolveTxHash).toBe("d".repeat(64));
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(fetchIndexedGame).toHaveBeenCalledTimes(1);
  });

  it("uses the configured API by default when NEXT_PUBLIC_API_BASE_URL is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:10000/api");
    vi.stubEnv("NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID", CONTRACT_ID);
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
    const getIndexedGame = vi
      .spyOn(ApiClient.prototype, "getIndexedGame")
      .mockResolvedValue({ success: true, data: indexedResolved });
    const fetchGame = vi.fn();

    const { result } = renderHook(() =>
      useCoinFlipGame(42n, { fetchGame, findResolveTx: vi.fn() }),
    );
    await advance(0);

    expect(result.current.status).toBe("resolved");
    expect(getIndexedGame).toHaveBeenCalledWith(CONTRACT_ID, "42");
    expect(fetchGame).not.toHaveBeenCalled();

    await advance(60_000);
    expect(getIndexedGame).toHaveBeenCalledTimes(1);
    expect(fetchGame).not.toHaveBeenCalled();
  });
});
