import { describe, it, expect } from "vitest";
import { buildRoundReport, ROUND_PRESETS, verifyRound } from "./round-verifier";

/**
 * Vectors produced by the Rust random-generator contract. A temporary test in
 * contracts/random-generator drove the real contract (commit_seeds →
 * request_random → fulfill_random → get_result) for each seed/request id/max
 * below and asserted `result == derive_result(..)` plus the stored commitment.
 * Vector d is also asserted by coin-flip's `test_resolve_loss` (seed 0, game 3
 * → 1 / Tails).
 */
const CONTRACT_VECTORS = [
  {
    name: "a",
    serverSeed: "0101010101010101010101010101010101010101010101010101010101010101",
    commitment: "72cd6e8422c407fb6d098690f1130b7ded7ec2f7f5e1d30bd9d521f015363793",
    requestId: 1n,
    max: 2n,
    result: 0n,
    digest: "bc731a1b09b9f3663488c106711bc05cb981c4be10b5f9bb338778d240416a94",
  },
  {
    name: "b",
    serverSeed: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    commitment: "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
    requestId: 42n,
    max: 2n,
    result: 1n,
    digest: "79513579350efb53b172672fa2478769a02f7b595f13be455a85140eba3b7951",
  },
  {
    name: "c",
    serverSeed: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    commitment: "af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051",
    requestId: 18446744073709551615n,
    max: 6n,
    result: 5n,
    digest: "6ecd0f0bd7cf53c56d2129820911a26f815949eee418ca46b4f3d7a80cd969a7",
  },
  {
    name: "d",
    serverSeed: "0000000000000000000000000000000000000000000000000000000000000000",
    commitment: "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925",
    requestId: 3n,
    max: 2n,
    result: 1n,
    digest: "20b73cd81b2b70717ee51e3a5495875788627ef3e93cea4f85ef71d7d9c32ef4",
  },
];

describe("verifyRound", () => {
  it.each(CONTRACT_VECTORS)("matches the contract's derive_result for vector $name", (v) => {
    const outcome = verifyRound(v);
    expect(outcome.commitmentOk).toBe(true);
    expect(outcome.recomputedCommitment).toBe(v.commitment);
    expect(outcome.digest).toBe(v.digest);
    expect(outcome.result).toBe(v.result);
  });

  it("accepts request ids and max as strings, as they arrive from a URL", () => {
    const v = CONTRACT_VECTORS[2];
    expect(verifyRound({ ...v, requestId: "18446744073709551615", max: "6" }).result).toBe(5n);
  });

  it("fails the commitment check for a seed that doesn't match", () => {
    const v = CONTRACT_VECTORS[0];
    const outcome = verifyRound({ ...v, serverSeed: CONTRACT_VECTORS[1].serverSeed });
    expect(outcome.commitmentOk).toBe(false);
  });

  it("rejects malformed input instead of guessing", () => {
    const v = CONTRACT_VECTORS[0];
    expect(() => verifyRound({ ...v, serverSeed: "abc" })).toThrow(/32 bytes/);
    expect(() => verifyRound({ ...v, requestId: "-1" })).toThrow(/64-bit/);
    expect(() => verifyRound({ ...v, requestId: "18446744073709551616" })).toThrow(/64-bit/);
    expect(() => verifyRound({ ...v, max: 1n })).toThrow(/at least 2/);
  });
});

describe("buildRoundReport", () => {
  const v = CONTRACT_VECTORS[1]; // seed 0x00..1f, request 42, max 2 → 1 (tails)

  it("passes every check for an authentic on-chain round", () => {
    const report = buildRoundReport(v, { result: 1n, game: { side: 1, resolved: true, won: true } });
    expect(report.isValid).toBe(true);
    expect(report.checks.map((c) => c.step)).toEqual([
      "Seed matches commitment",
      "Recompute result",
      "Matches on-chain result",
      "Game outcome consistent",
    ]);
    expect(report.outcomeLabel).toBe("Tails (1)");
  });

  it("shows a failed check when the seed doesn't match the commitment", () => {
    const report = buildRoundReport({ ...v, serverSeed: CONTRACT_VECTORS[0].serverSeed }, { result: 1n });
    expect(report.isValid).toBe(false);
    expect(report.checks[0]).toMatchObject({ step: "Seed matches commitment", passed: false });
  });

  it("fails when the stored result or the settled win/loss disagree", () => {
    expect(buildRoundReport(v, { result: 0n }).checks[2].passed).toBe(false);
    const lying = buildRoundReport(v, { result: 1n, game: { side: 0, resolved: true, won: true } });
    expect(lying.isValid).toBe(false);
    expect(lying.checks[3].passed).toBe(false);
  });

  it("checks a claimed result in manual mode and reports bad input", () => {
    expect(buildRoundReport({ ...v, claimedResult: "1" }).isValid).toBe(true);
    expect(buildRoundReport({ ...v, claimedResult: "0" }).isValid).toBe(false);
    const bad = buildRoundReport({ ...v, serverSeed: "zz" });
    expect(bad.isValid).toBe(false);
    expect(bad.checks[0].step).toBe("Parse inputs");
  });

  it("ships presets that verify (or fail) as labelled", () => {
    for (const preset of ROUND_PRESETS) {
      expect(buildRoundReport(preset.input).isValid).toBe(!preset.id.endsWith("fail"));
    }
  });
});
