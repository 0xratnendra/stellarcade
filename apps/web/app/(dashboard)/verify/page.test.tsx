import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));

const chain = vi.hoisted(() => ({ getRandomResult: vi.fn(), getGame: vi.fn() }));
vi.mock("../../../src/services/coin-flip-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/coin-flip-client")>()),
  getRandomResult: chain.getRandomResult,
  getGame: chain.getGame,
}));

import VerifyPage from "./page";

// Contract-generated vector (see src/utils/round-verifier.test.ts): request 42 → 1.
const SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const COMMITMENT = "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd";
const RNG_ID = "CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5";

describe("VerifyPage", () => {
  beforeEach(() => {
    search.params = new URLSearchParams();
    chain.getRandomResult.mockReset();
    chain.getGame.mockReset();
    vi.stubEnv("NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID", "CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5");
    vi.stubEnv("NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID", "CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK", "testnet");
  });

  it("renders the contract-formula inputs", () => {
    render(<VerifyPage />);
    expect(screen.getByRole("heading", { level: 1, name: /Provable Fairness Verifier/i })).toBeInTheDocument();
    expect(screen.getByTestId("input-server-seed")).toBeInTheDocument();
    expect(screen.getByTestId("input-commit-hash")).toBeInTheDocument();
    expect(screen.getByTestId("input-request-id")).toBeInTheDocument();
    expect(screen.getByTestId("select-game-range")).toBeInTheDocument();
    expect(screen.queryByTestId("input-client-seed")).not.toBeInTheDocument();
  });

  it("verifies the default contract vector in manual mode", async () => {
    render(<VerifyPage />);
    await waitFor(() => {
      expect(screen.getByTestId("verification-status-banner")).toHaveTextContent(/PROVABLY FAIR VERIFIED/i);
    });
    expect(screen.getByTestId("outcome-value-text")).toHaveTextContent("Tails (1)");
  });

  it("shows a failed check for a tampered seed preset", async () => {
    render(<VerifyPage />);
    fireEvent.click(screen.getByTestId("preset-tampered-fail"));
    await waitFor(() => {
      expect(screen.getByTestId("verification-status-banner")).toHaveTextContent(/VERIFICATION FAILED/i);
    });
    expect(screen.getByTestId("step-item-0")).toHaveTextContent(/FAILED/);
  });

  it("verifies a real round loaded by requestId from the contract", async () => {
    search.params = new URLSearchParams("requestId=42");
    chain.getRandomResult.mockResolvedValue({ max: 2n, serverSeed: SEED, commitment: COMMITMENT, result: 1n });
    chain.getGame.mockResolvedValue({ player: "G", side: 1, wager: 10n, resolved: true, won: true, payout: 19n });

    render(<VerifyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("onchain-status")).toHaveTextContent(/Loaded round 42 from chain/);
    });
    expect(chain.getRandomResult).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(String), 42n);
    expect(await screen.findByText("Matches on-chain result")).toBeInTheDocument();
    expect(screen.getByText("Game outcome consistent")).toBeInTheDocument();
    expect(screen.getByTestId("verification-status-banner")).toHaveTextContent(/PROVABLY FAIR VERIFIED/i);
  });

  it("fails the check when the on-chain result disagrees with the recomputation", async () => {
    search.params = new URLSearchParams("requestId=42");
    chain.getRandomResult.mockResolvedValue({ max: 2n, serverSeed: SEED, commitment: COMMITMENT, result: 0n });
    chain.getGame.mockRejectedValue(new Error("not a coin flip game"));

    render(<VerifyPage />);

    expect(await screen.findByText("Matches on-chain result")).toBeInTheDocument();
    expect(screen.getByTestId("verification-status-banner")).toHaveTextContent(/VERIFICATION FAILED/i);
  });

  it("explains when the round is not fulfilled yet", async () => {
    search.params = new URLSearchParams("requestId=7");
    chain.getRandomResult.mockRejectedValue(new Error("HostError: Error(Contract, #6)"));

    render(<VerifyPage />);

    await waitFor(() => {
      expect(screen.getByTestId("onchain-status")).toHaveTextContent(/not been fulfilled/);
    });
  });

  it("copies audit JSON to clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<VerifyPage />);
    await waitFor(() => {
      expect(screen.getByTestId("btn-copy-report")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("btn-copy-report"));
    expect(writeTextMock).toHaveBeenCalled();
  });

  it("explains the commit-reveal scheme with working links", () => {
    render(<VerifyPage />);

    // The section carries the anchor other pages link to (#how-it-works).
    const heading = screen.getByRole("heading", { level: 2, name: /How this works/i });
    expect(heading).toHaveAttribute("id", "how-it-works");

    // Four-step diagram, in order.
    const flow = screen.getByTestId("fairness-flow");
    expect(flow).toHaveTextContent(/The oracle commits/);
    expect(flow).toHaveTextContent(/Your bet locks it in/);
    expect(flow).toHaveTextContent(/The seed is revealed/);
    expect(flow).toHaveTextContent(/You recompute it/);

    // The stated formula is the contract's: sha256(seed || round id), first 8
    // bytes big-endian, mod 2 (0 heads / 1 tails).
    expect(screen.getByTestId("fairness-formula")).toHaveTextContent(
      /sha256\(server_seed ‖ round_id\)/,
    );
    expect(screen.getByTestId("fairness-formula")).toHaveTextContent(/% 2/);
    expect(screen.getByTestId("fairness-formula")).toHaveTextContent(/0 is Heads, 1 is Tails/);

    // Honest limits and the refund path the contract provides instead.
    expect(screen.getByTestId("fairness-limits")).toHaveTextContent(/cancel_stale_bet/);
    expect(screen.getByTestId("fairness-limits")).toHaveTextContent(/17,280 ledgers/);

    // Manifest address resolves to the explorer contract page for this network.
    expect(screen.getByTestId("rng-contract-address")).toHaveTextContent(RNG_ID);
    expect(screen.getByTestId("rng-contract-explorer-link")).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/contract/${RNG_ID}`,
    );
  });
});
