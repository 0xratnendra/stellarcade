import { describe, it, expect, vi } from "vitest";
import { getPlayerBadges, type BadgeClientConfig } from "./badge-client";

const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

const CONFIG: BadgeClientConfig = {
  contractId: "CC7SDE6RRV4X7XRHU6OM6GLDIKBC6EZYNHTRGDLEHYNVUWWO3LUJLA5M",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

function makeSimServer(responses: unknown[]): { simulateTransaction: ReturnType<typeof vi.fn> } {
  let call = 0;
  return {
    simulateTransaction: vi.fn().mockImplementation(() => {
      const val = responses[call++];
      return Promise.resolve({
        result: { retval: { toXDR: () => Buffer.alloc(0) } },
        _parsed: val,
      });
    }),
  };
}

function makeScValResponse(native: unknown) {
  return {
    result: { retval: { type: "scvVec" } },
    _native: native,
  };
}

describe("getPlayerBadges (#1511)", () => {
  it("returns empty array when config is null (contract not configured)", async () => {
    const result = await getPlayerBadges(PLAYER, { config: null });
    expect(result).toEqual([]);
  });

  it("maps contract response to CollectiblePortfolioItem array", async () => {
    const mockServer = {
      simulateTransaction: vi.fn()
        .mockResolvedValueOnce({
          result: { retval: { type: "scvVec" } },
        })
        .mockResolvedValueOnce({
          result: { retval: { type: "scvMap" } },
        }),
    };

    vi.doMock("@stellar/stellar-sdk", async (orig) => {
      const actual = await orig<typeof import("@stellar/stellar-sdk")>();
      return {
        ...actual,
        scValToNative: vi.fn()
          .mockReturnValueOnce([1n])
          .mockReturnValueOnce({ found: true, title: "First Win", badge_id: 1n }),
      };
    });

    const { getPlayerBadges: getBadges } = await import("./badge-client");
    const result = await getBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "1", name: "First Win", rarity: "achievement" });
  });

  it("returns empty array when player has no badges", async () => {
    const mockServer = {
      simulateTransaction: vi.fn().mockResolvedValueOnce({
        result: { retval: { type: "scvVec" } },
      }),
    };

    vi.doMock("@stellar/stellar-sdk", async (orig) => {
      const actual = await orig<typeof import("@stellar/stellar-sdk")>();
      return {
        ...actual,
        scValToNative: vi.fn().mockReturnValueOnce([]),
      };
    });

    const { getPlayerBadges: getBadges } = await import("./badge-client");
    const result = await getBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toEqual([]);
  });

  it("hides badges with found=false from the response", async () => {
    const mockServer = {
      simulateTransaction: vi.fn()
        .mockResolvedValueOnce({ result: { retval: { type: "scvVec" } } })
        .mockResolvedValueOnce({ result: { retval: { type: "scvMap" } } }),
    };

    vi.doMock("@stellar/stellar-sdk", async (orig) => {
      const actual = await orig<typeof import("@stellar/stellar-sdk")>();
      return {
        ...actual,
        scValToNative: vi.fn()
          .mockReturnValueOnce([99n])
          .mockReturnValueOnce({ found: false, title: "", badge_id: 99n }),
      };
    });

    const { getPlayerBadges: getBadges } = await import("./badge-client");
    const result = await getBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toEqual([]);
  });
});
