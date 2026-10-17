import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCoinFlipGame } from "./useCoinFlipGame";
import type { CoinFlipGameState } from "../services/coin-flip-client";

const unresolved: CoinFlipGameState = {
  player: "G...",
  side: 0,
  wager: 10_000_000n,
  resolved: false,
  won: false,
  payout: 0n,
};
const resolvedWin: CoinFlipGameState = { ...unresolved, resolved: true, won: true, payout: 19_750_000n };

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
});
