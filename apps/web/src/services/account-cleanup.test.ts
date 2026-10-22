import { describe, it, expect, vi } from "vitest";
import { buildCleanupTransaction, calculateReclaimedXlm } from "./account-cleanup";
import type { CleanableSubentry } from "../utils/account-hygiene";
import { Horizon } from "@stellar/stellar-sdk";

const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const NETWORK = "Test SDF Network ; September 2015";

function makeAccount(overrides: Partial<Horizon.AccountResponse> = {}): Horizon.AccountResponse {
  return {
    id: PLAYER,
    account_id: PLAYER,
    sequence: "100",
    subentry_count: 0,
    last_modified_ledger: 1,
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
    balances: [{ asset_type: "native", balance: "100.0000000" } as Horizon.HorizonApi.BalanceLine],
    signers: [],
    data: {},
    _links: {} as any,
    ...overrides,
  } as unknown as Horizon.AccountResponse;
}

const mockHorizon = {
  loadAccount: vi.fn().mockResolvedValue(makeAccount()),
};

describe("buildCleanupTransaction (#1507)", () => {
  it("builds a changeTrust operation for trustline subentries", async () => {
    const subentries: CleanableSubentry[] = [
      {
        id: "tl-test",
        type: "trustline",
        assetCode: "USDC",
        assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        description: "Stale USDC trustline",
        lockedReserveXlm: 0.5,
        canReclaim: true,
      },
    ];

    const tx = await buildCleanupTransaction(PLAYER, subentries, NETWORK, {
      horizon: mockHorizon as any,
    });
    const ops = tx.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("changeTrust");
    expect((ops[0] as any).limit).toBe("0.0000000");
  });

  it("builds a setOptions operation for signer subentries", async () => {
    const signerKey = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const subentries: CleanableSubentry[] = [
      {
        id: signerKey,
        type: "signer",
        description: "Stale co-signer",
        lockedReserveXlm: 0.5,
        canReclaim: true,
      },
    ];

    const tx = await buildCleanupTransaction(PLAYER, subentries, NETWORK, {
      horizon: mockHorizon as any,
    });
    const ops = tx.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("setOptions");
    expect((ops[0] as any).signer.weight).toBe(0);
  });

  it("builds a manageData operation for data_entry subentries", async () => {
    const subentries: CleanableSubentry[] = [
      {
        id: "config_key",
        type: "data_entry",
        description: "Stale data entry",
        lockedReserveXlm: 0.5,
        canReclaim: true,
      },
    ];

    const tx = await buildCleanupTransaction(PLAYER, subentries, NETWORK, {
      horizon: mockHorizon as any,
    });
    const ops = tx.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("manageData");
    expect((ops[0] as any).value).toBeNull();
  });

  it("throws for unsupported subentry types", async () => {
    const subentries = [
      { id: "cb-1", type: "claimable_balance", description: "x", lockedReserveXlm: 0.5, canReclaim: true },
    ] as CleanableSubentry[];

    await expect(
      buildCleanupTransaction(PLAYER, subentries, NETWORK, { horizon: mockHorizon as any }),
    ).rejects.toThrow(/unsupported subentry type/i);
  });

  it("builds multiple operations for mixed subentry types", async () => {
    const subentries: CleanableSubentry[] = [
      {
        id: "tl-multi",
        type: "trustline",
        assetCode: "ARS",
        assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        description: "Stale ARS trustline",
        lockedReserveXlm: 0.5,
        canReclaim: true,
      },
      {
        id: "my_data",
        type: "data_entry",
        description: "Stale data entry",
        lockedReserveXlm: 0.5,
        canReclaim: true,
      },
    ];

    const tx = await buildCleanupTransaction(PLAYER, subentries, NETWORK, {
      horizon: mockHorizon as any,
    });
    expect(tx.operations).toHaveLength(2);
    expect(tx.operations[0].type).toBe("changeTrust");
    expect(tx.operations[1].type).toBe("manageData");
  });
});

describe("calculateReclaimedXlm (#1507)", () => {
  it("returns the positive XLM difference between before and after scans", () => {
    const before = makeAccount({ balances: [{ asset_type: "native", balance: "100.0000000" } as any] });
    const after = makeAccount({ balances: [{ asset_type: "native", balance: "101.0000000" } as any] });
    expect(calculateReclaimedXlm(before, after)).toBeCloseTo(1, 5);
  });

  it("returns 0 when balance did not increase (e.g. fees exceeded reserves)", () => {
    const before = makeAccount({ balances: [{ asset_type: "native", balance: "100.0000000" } as any] });
    const after = makeAccount({ balances: [{ asset_type: "native", balance: "99.9999900" } as any] });
    expect(calculateReclaimedXlm(before, after)).toBe(0);
  });
});
