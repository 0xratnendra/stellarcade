import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mapQuests, useQuests } from "./player-data";
import { ApiClient } from "./typed-api-sdk";

vi.mock("../hooks/useWalletStatus", () => ({
  useWalletStatus: vi.fn(() => ({ address: null, status: "DISCONNECTED" })),
}));

describe("mapQuests", () => {
  it("maps null/undefined/empty input to default catalog with 0 progress and uncompleted", () => {
    const questsFromNull = mapQuests(null);
    expect(questsFromNull.length).toBeGreaterThanOrEqual(3);
    for (const q of questsFromNull) {
      expect(q.progress).toBe(0);
      expect(q.completed).toBe(false);
      expect(q.claimed).toBe(false);
      expect(q.total).toBeGreaterThan(0);
    }

    const questsFromEmpty = mapQuests([]);
    expect(questsFromEmpty).toEqual(questsFromNull);
  });

  it("maps real progress from backend response for known and custom quests", () => {
    const rawDtos = [
      {
        questId: "daily-login",
        progress: 1,
        target: 1,
        claimed: true,
        streak: 3,
      },
      {
        questId: "play-5-games",
        progress: 3,
        target: 5,
        claimed: false,
        streak: 0,
      },
      {
        questId: "win-3-games",
        progress: 3,
        target: 3,
        claimed: false,
        streak: 0,
      },
      {
        questId: "community-challenge",
        progress: 8,
        target: 10,
        claimed: false,
        streak: 1,
      },
    ];

    const mapped = mapQuests(rawDtos);
    expect(mapped).toHaveLength(4);

    const login = mapped.find((q) => q.id === "daily-login");
    expect(login).toBeDefined();
    expect(login?.progress).toBe(1);
    expect(login?.total).toBe(1);
    expect(login?.completed).toBe(true);
    expect(login?.claimed).toBe(true);

    const play = mapped.find((q) => q.id === "play-5-games");
    expect(play).toBeDefined();
    expect(play?.progress).toBe(3);
    expect(play?.total).toBe(5);
    expect(play?.completed).toBe(false);
    expect(play?.claimed).toBe(false);

    const win = mapped.find((q) => q.id === "win-3-games");
    expect(win).toBeDefined();
    expect(win?.progress).toBe(3);
    expect(win?.total).toBe(3);
    expect(win?.completed).toBe(true);
    expect(win?.claimed).toBe(false);

    const custom = mapped.find((q) => q.id === "community-challenge");
    expect(custom).toBeDefined();
    expect(custom?.title).toBe("Community Challenge");
    expect(custom?.progress).toBe(8);
    expect(custom?.total).toBe(10);
    expect(custom?.completed).toBe(false);
  });
});

describe("useQuests hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns default catalog with 0 progress and not loading when no player is connected", () => {
    const { result } = renderHook(() => useQuests(null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.items.length).toBeGreaterThanOrEqual(3);
    expect(result.current.items.every((q) => q.progress === 0)).toBe(true);
  });

  it("fetches quests from API when a player address is provided and maps them successfully", async () => {
    vi.spyOn(ApiClient.prototype, "getQuests").mockResolvedValueOnce({
      success: true,
      data: [
        {
          questId: "daily-login",
          progress: 1,
          target: 1,
          claimed: false,
          streak: 1,
        },
        {
          questId: "play-5-games",
          progress: 4,
          target: 5,
          claimed: false,
          streak: 0,
        },
      ],
    });

    const { result } = renderHook(() => useQuests("GALICE123"));

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toMatchObject({
      id: "daily-login",
      progress: 1,
      total: 1,
      completed: true,
    });
    expect(result.current.items[1]).toMatchObject({
      id: "play-5-games",
      progress: 4,
      total: 5,
      completed: false,
    });
  });

  it("records error state when API request fails", async () => {
    vi.spyOn(ApiClient.prototype, "getQuests").mockResolvedValueOnce({
      success: false,
      error: {
        code: "API_NETWORK_ERROR",
        message: "Failed to connect to backend",
        category: "network",
        severity: "terminal",
        domain: "api",
      },
    });

    const { result } = renderHook(() => useQuests("GALICE123"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to connect to backend");
  });
});
