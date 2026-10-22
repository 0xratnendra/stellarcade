import { describe, it, expect, vi } from "vitest";
import { getPlayerBadges, type BadgeClientConfig } from "./badge-client";
import { nativeToScVal } from "@stellar/stellar-sdk";

const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

const CONFIG: BadgeClientConfig = {
  contractId: "CC7SDE6RRV4X7XRHU6OM6GLDIKBC6EZYNHTRGDLEHYNVUWWO3LUJLA5M",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("getPlayerBadges (#1511)", () => {
  it("returns empty array when config is null (contract not configured)", async () => {
    const result = await getPlayerBadges(PLAYER, { config: null });
    expect(result).toEqual([]);
  });

  it("maps contract response to CollectiblePortfolioItem array", async () => {
    const mockServer = {
      simulateTransaction: vi.fn()
        .mockResolvedValueOnce({
          result: { retval: nativeToScVal([1n]) },
        })
        .mockResolvedValueOnce({
          result: { retval: nativeToScVal({ found: true, title: "First Win", badge_id: 1n }) },
        }),
    };

    const result = await getPlayerBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "1", name: "First Win", rarity: "achievement" });
  });

  it("returns empty array when player has no badges", async () => {
    const mockServer = {
      simulateTransaction: vi.fn().mockResolvedValueOnce({
        result: { retval: nativeToScVal([]) },
      }),
    };

    const result = await getPlayerBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toEqual([]);
  });

  it("hides badges with found=false from the response", async () => {
    const mockServer = {
      simulateTransaction: vi.fn()
        .mockResolvedValueOnce({ result: { retval: nativeToScVal([99n]) } })
        .mockResolvedValueOnce({ result: { retval: nativeToScVal({ found: false, title: "", badge_id: 99n }) } }),
    };

    const result = await getPlayerBadges(PLAYER, { server: mockServer as any, config: CONFIG });
    expect(result).toEqual([]);
  });
});
