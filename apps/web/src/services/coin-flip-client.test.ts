import { describe, it, expect, vi } from "vitest";
import {
  Account,
  Address,
  Networks,
  scValToNative,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  CoinFlipBetError,
  placeBet,
  xlmToStroops,
  stroopsToXlm,
  type CoinFlipConfig,
  type CoinFlipRpc,
  type CoinFlipWallet,
} from "./coin-flip-client";
import { RejectedSignatureError } from "../types/wallet-session";

const CONFIG: CoinFlipConfig = {
  contractId: "CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
};
// Fixed account (seed = 32 × 0x07); Keypair.random() trips over jsdom's Uint8Array realm.
const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const TX_HASH = "a".repeat(64);

function makeRpc(overrides: Partial<CoinFlipRpc> = {}) {
  const prepared: Transaction[] = [];
  const rpc: CoinFlipRpc = {
    getAccount: vi.fn(async (address: string) => new Account(address, "100")),
    prepareTransaction: vi.fn(async (tx: Transaction) => {
      prepared.push(tx);
      return tx;
    }),
    sendTransaction: vi.fn(async () => ({ status: "PENDING", hash: TX_HASH }) as never),
    getTransaction: vi
      .fn()
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValue({ status: "SUCCESS" }),
    ...overrides,
  };
  return { rpc, prepared };
}

const passthroughWallet = (): CoinFlipWallet => ({
  signTransaction: vi.fn(async (txXdr: string) => txXdr),
});

const noSleep = async () => {};

function invokeArgs(tx: Transaction): { fn: string; args: xdr.ScVal[]; contract: string } {
  const op = tx.operations[0] as unknown as { func: xdr.HostFunction };
  const invoke = op.func.invokeContract();
  return {
    contract: Address.fromScAddress(invoke.contractAddress()).toString(),
    fn: invoke.functionName().toString(),
    args: invoke.args(),
  };
}

describe("xlmToStroops", () => {
  it("converts whole and fractional XLM with integer maths", () => {
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("5.5")).toBe(55_000_000n);
    expect(xlmToStroops("0.1")).toBe(1_000_000n);
  });

  it("handles the smallest unit, 0.0000001 XLM = 1 stroop", () => {
    expect(xlmToStroops("0.0000001")).toBe(1n);
  });

  it("handles large values exactly, beyond float precision", () => {
    // 2^53 + 1 stroops would round in floating point.
    expect(xlmToStroops("900719925.4740993")).toBe(9_007_199_254_740_993n);
    expect(xlmToStroops("17014118346046923173168730371588.4105727")).toBe((1n << 127n) - 1n);
  });

  it("rejects zero, negatives, too many decimals and overflow", () => {
    expect(() => xlmToStroops("0")).toThrow(RangeError);
    expect(() => xlmToStroops("-1")).toThrow(RangeError);
    expect(() => xlmToStroops("1.00000001")).toThrow(RangeError);
    expect(() => xlmToStroops("1e3")).toThrow(RangeError);
    expect(() => xlmToStroops("17014118346046923173168730371588.4105728")).toThrow(/too large/);
  });

  it("round-trips through stroopsToXlm", () => {
    expect(stroopsToXlm(xlmToStroops("12.3400000"))).toBe("12.34");
    expect(stroopsToXlm(1n)).toBe("0.0000001");
  });
});

describe("placeBet", () => {
  it("builds place_bet with Address, u32, i128 and u64 arguments", async () => {
    const { rpc, prepared } = makeRpc();
    const result = await placeBet(
      { player: PLAYER, side: 1, wagerXlm: "2.5" },
      { rpc, wallet: passthroughWallet(), config: CONFIG, generateGameId: () => 12345678901234567890n, sleep: noSleep },
    );

    expect(result).toEqual({ gameId: 12345678901234567890n, txHash: TX_HASH });
    const { fn, args, contract } = invokeArgs(prepared[0]);
    expect(contract).toBe(CONFIG.contractId);
    expect(fn).toBe("place_bet");
    expect(args.map((a) => a.switch().name)).toEqual(["scvAddress", "scvU32", "scvI128", "scvU64"]);
    expect(scValToNative(args[0])).toBe(PLAYER);
    expect(scValToNative(args[1])).toBe(1);
    expect(scValToNative(args[2])).toBe(25_000_000n);
    expect(scValToNative(args[3])).toBe(12345678901234567890n);
  });

  it("signs with the configured network passphrase and polls until confirmed", async () => {
    const { rpc } = makeRpc();
    const wallet = passthroughWallet();
    await placeBet(
      { player: PLAYER, side: 0, wagerXlm: "1" },
      { rpc, wallet, config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
    );
    expect(wallet.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      networkPassphrase: Networks.TESTNET,
    });
    expect(rpc.getTransaction).toHaveBeenCalledTimes(2);
  });

  it("regenerates the game id and retries once on GameAlreadyExists", async () => {
    const prepare = vi
      .fn()
      .mockRejectedValueOnce(new Error("HostError: Error(Contract, #6)"))
      .mockImplementation(async (tx: Transaction) => tx);
    const { rpc } = makeRpc({ prepareTransaction: prepare });
    const ids = [7n, 8n];

    const result = await placeBet(
      { player: PLAYER, side: 0, wagerXlm: "1" },
      { rpc, wallet: passthroughWallet(), config: CONFIG, generateGameId: () => ids.shift()!, sleep: noSleep },
    );

    expect(result.gameId).toBe(8n);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("does not retry a second GameAlreadyExists", async () => {
    const prepare = vi.fn().mockRejectedValue(new Error("HostError: Error(Contract, #6)"));
    const { rpc } = makeRpc({ prepareTransaction: prepare });

    await expect(
      placeBet(
        { player: PLAYER, side: 0, wagerXlm: "1" },
        { rpc, wallet: passthroughWallet(), config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(CoinFlipBetError);
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("a rejected signature submits nothing and reports the rejection", async () => {
    const { rpc } = makeRpc();
    const wallet: CoinFlipWallet = {
      signTransaction: vi.fn().mockRejectedValue(new RejectedSignatureError()),
    };

    const error = await placeBet(
      { player: PLAYER, side: 0, wagerXlm: "1" },
      { rpc, wallet, config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CoinFlipBetError);
    expect((error as CoinFlipBetError).appError.code).toBe("WALLET_USER_REJECTED");
    expect((error as CoinFlipBetError).message).toBe("Transaction was rejected by the user.");
    expect(rpc.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [4, "CONTRACT_INVALID_AMOUNT", "Amount must be greater than zero."],
    [10, "CONTRACT_WAGER_TOO_LOW", "Wager is below the minimum bet for this game."],
    [11, "CONTRACT_WAGER_TOO_HIGH", "Wager is above the maximum bet for this game."],
    [13, "CONTRACT_INSUFFICIENT_HOUSE_LIQUIDITY", "The house cannot cover this wager right now. Try a smaller bet."],
  ])("maps contract error #%i to %s", async (code, appCode, message) => {
    const { rpc } = makeRpc({
      prepareTransaction: vi.fn().mockRejectedValue(new Error(`HostError: Error(Contract, #${code})`)),
    });
    const wallet = passthroughWallet();

    const error = (await placeBet(
      { player: PLAYER, side: 0, wagerXlm: "1" },
      { rpc, wallet, config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
    ).catch((e: unknown) => e)) as CoinFlipBetError;

    expect(error.appError.code).toBe(appCode);
    expect(error.message).toBe(message);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
  });

  it("fails when the network rejects the submission", async () => {
    const { rpc } = makeRpc({
      sendTransaction: vi.fn(async () => ({ status: "TRY_AGAIN_LATER", hash: TX_HASH }) as never),
    });
    await expect(
      placeBet(
        { player: PLAYER, side: 0, wagerXlm: "1" },
        { rpc, wallet: passthroughWallet(), config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
      ),
    ).rejects.toThrow(/rejected by the network/);
    expect(rpc.getTransaction).not.toHaveBeenCalled();
  });

  it("fails when the transaction fails on-chain", async () => {
    const { rpc } = makeRpc({
      getTransaction: vi.fn().mockResolvedValue({ status: "FAILED", diagnosticEventsXdr: [] }),
    });
    await expect(
      placeBet(
        { player: PLAYER, side: 0, wagerXlm: "1" },
        { rpc, wallet: passthroughWallet(), config: CONFIG, generateGameId: () => 1n, sleep: noSleep },
      ),
    ).rejects.toThrow(/failed on-chain/);
  });

  it("rejects an invalid wager before touching the network", async () => {
    const { rpc } = makeRpc();
    await expect(
      placeBet(
        { player: PLAYER, side: 0, wagerXlm: "0.00000001" },
        { rpc, wallet: passthroughWallet(), config: CONFIG, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(CoinFlipBetError);
    expect(rpc.getAccount).not.toHaveBeenCalled();
  });
});
