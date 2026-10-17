/**
 * Round verification that mirrors the random-generator contract exactly.
 *
 * The contract (`derive_result` in contracts/random-generator/src/lib.rs)
 * computes `sha256(server_seed || request_id_be_bytes)`, reads the first 8
 * bytes as a big-endian u64 and reduces it modulo `max`. Fulfilment is only
 * accepted when `sha256(server_seed)` equals the commitment the oracle
 * published before the request. There is no client seed or extra entropy.
 */

import { hash } from "@stellar/stellar-sdk";

const U64_MAX = (1n << 64n) - 1n;

export interface VerifyRoundInput {
  /** 32-byte server seed, hex encoded (64 hex chars). */
  serverSeed: string;
  /** sha256(server_seed), hex encoded (64 hex chars). */
  commitment: string;
  /** u64 request id; for coin flip this is the game id. */
  requestId: bigint | string | number;
  /** Outcome space; 2 for coin flip. */
  max: bigint | string | number;
}

export interface VerifyRoundResult {
  commitmentOk: boolean;
  result: bigint;
  /** sha256(server_seed) as recomputed here, hex. */
  recomputedCommitment: string;
  /** sha256(server_seed || request_id_be), hex. */
  digest: string;
}

function parseHex32(value: string, field: string): Uint8Array {
  const clean = value.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${field} must be 32 bytes of hex (64 characters)`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sha256(bytes: Uint8Array): Uint8Array {
  // stellar-sdk's hash() takes its Buffer polyfill type; a Uint8Array view of
  // the same bytes is what it reads, and avoids relying on a global Buffer.
  return new Uint8Array(hash(bytes as Parameters<typeof hash>[0]));
}

function parseU64(value: bigint | string | number, field: string): bigint {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value).trim());
  } catch {
    throw new Error(`${field} must be an unsigned 64-bit integer`);
  }
  if (parsed < 0n || parsed > U64_MAX) {
    throw new Error(`${field} must be an unsigned 64-bit integer`);
  }
  return parsed;
}

/** Recomputes a round's result and checks the seed against its commitment. */
export function verifyRound(input: VerifyRoundInput): VerifyRoundResult {
  const seed = parseHex32(input.serverSeed, "serverSeed");
  const commitment = parseHex32(input.commitment, "commitment");
  const requestId = parseU64(input.requestId, "requestId");
  const max = parseU64(input.max, "max");
  if (max < 2n) {
    throw new Error("max must be at least 2");
  }

  const recomputed = sha256(seed);
  const preimage = new Uint8Array(40);
  preimage.set(seed, 0);
  new DataView(preimage.buffer).setBigUint64(32, requestId, false);
  const digest = sha256(preimage);

  return {
    commitmentOk: toHex(recomputed) === toHex(commitment),
    result: new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0, false) % max,
    recomputedCommitment: toHex(recomputed),
    digest: toHex(digest),
  };
}

export interface RoundCheck {
  step: string;
  passed: boolean;
  actual: string;
  details: string;
}

export interface RoundReport {
  isValid: boolean;
  result: bigint | null;
  outcomeLabel: string;
  checks: RoundCheck[];
}

/** Values read from chain for a request (random-generator `get_result`, coin-flip `get_game`). */
export interface OnChainRound {
  result: bigint;
  game?: { side: number; resolved: boolean; won: boolean; refunded?: boolean } | null;
}

export function formatOutcome(result: bigint, max: bigint): string {
  if (max === 2n) return result === 0n ? "Heads (0)" : "Tails (1)";
  if (max === 6n) return `Dice ${result + 1n} (raw ${result})`;
  return `${result} of 0..${max - 1n}`;
}

/**
 * Runs every check for a round and reports pass/fail for each. With
 * `onChain`, the recomputed result is compared with the contract's stored
 * result and, for coin flip, with the game's recorded win/loss.
 */
export function buildRoundReport(
  input: VerifyRoundInput & { claimedResult?: bigint | string | null },
  onChain?: OnChainRound,
): RoundReport {
  let outcome: VerifyRoundResult;
  try {
    outcome = verifyRound(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isValid: false,
      result: null,
      outcomeLabel: "—",
      checks: [{ step: "Parse inputs", passed: false, actual: "invalid input", details: message }],
    };
  }

  const max = BigInt(String(input.max));
  const checks: RoundCheck[] = [
    {
      step: "Seed matches commitment",
      passed: outcome.commitmentOk,
      actual: outcome.recomputedCommitment,
      details: outcome.commitmentOk
        ? "sha256(server_seed) equals the commitment published before the bet."
        : "MISMATCH: sha256(server_seed) does not equal the published commitment.",
    },
    {
      step: "Recompute result",
      passed: true,
      actual: outcome.result.toString(),
      details: `sha256(server_seed || request_id_be)[0..8] % ${max} = ${outcome.result}`,
    },
  ];

  const expected = onChain?.result ?? (input.claimedResult != null && String(input.claimedResult).trim() !== ""
    ? BigInt(String(input.claimedResult).trim())
    : null);
  if (expected !== null) {
    const matches = expected === outcome.result;
    checks.push({
      step: onChain ? "Matches on-chain result" : "Matches claimed result",
      passed: matches,
      actual: expected.toString(),
      details: matches
        ? "The recomputed result equals the recorded result."
        : `MISMATCH: recorded ${expected}, recomputed ${outcome.result}.`,
    });
  }

  const game = onChain?.game;
  if (game && game.resolved && !game.refunded) {
    const playerShouldWin = BigInt(game.side) === outcome.result;
    const consistent = game.won === playerShouldWin;
    checks.push({
      step: "Game outcome consistent",
      passed: consistent,
      actual: game.won ? "won" : "lost",
      details: consistent
        ? `The player picked ${game.side === 0 ? "heads" : "tails"} and the game was settled as a ${game.won ? "win" : "loss"}.`
        : "MISMATCH: the settled win/loss does not follow from the result.",
    });
  }

  return {
    isValid: checks.every((c) => c.passed),
    result: outcome.result,
    outcomeLabel: formatOutcome(outcome.result, max),
    checks,
  };
}

/** Presets for the manual mode, taken from the contract-generated vectors. */
export const ROUND_PRESETS = [
  {
    id: "coin-flip-pass",
    name: "Coin flip (valid)",
    input: {
      serverSeed: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      commitment: "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
      requestId: "42",
      max: "2",
    },
  },
  {
    id: "dice-pass",
    name: "Range of 6 (valid)",
    input: {
      serverSeed: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      commitment: "af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051",
      requestId: "18446744073709551615",
      max: "6",
    },
  },
  {
    id: "tampered-fail",
    name: "Tampered seed (fails)",
    input: {
      serverSeed: "0101010101010101010101010101010101010101010101010101010101010101",
      commitment: "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
      requestId: "1",
      max: "2",
    },
  },
] as const;
