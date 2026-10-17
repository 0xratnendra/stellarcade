#!/usr/bin/env node
/**
 * Testnet smoke test: plays one real coin-flip round end to end.
 *
 *   node scripts/smoke/coin-flip-round.mjs \
 *     [--deployment deployments/testnet.json] [--api-url https://.../api] [--timeout 180]
 *
 * Every step prints PASS/FAIL; the script exits non-zero on the first failure.
 * The only key it uses is a throwaway player keypair it creates and funds with
 * Friendbot. The bet is resolved by the deployed oracle worker, not by us.
 *
 * Needs @stellar/stellar-sdk, resolved from apps/web (run `pnpm install` first).
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} = require("@stellar/stellar-sdk");

const { values: args } = parseArgs({
  options: {
    deployment: { type: "string", default: "deployments/testnet.json" },
    "api-url": { type: "string", default: process.env.SMOKE_API_URL ?? "" },
    timeout: { type: "string", default: "180" },
  },
});

const HEADS = 0;
const BASIS_POINTS = 10_000n;
const FRIENDBOT_URL = "https://friendbot.stellar.org";

let stepNumber = 0;

/** Runs one step, printing PASS/FAIL; any failure ends the run with exit 1. */
async function step(name, fn) {
  stepNumber += 1;
  const label = `[${String(stepNumber).padStart(2, "0")}] ${name}`;
  try {
    const value = await fn();
    const detail = typeof value === "string" || typeof value === "bigint" ? ` — ${value}` : "";
    console.log(`PASS ${label}${detail}`);
    return value;
  } catch (error) {
    console.log(`FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

let server;
let deployment;

async function simulateRead(contractId, method, scArgs = []) {
  // Simulation never touches the source account, so it needn't exist on-chain.
  const tx = new TransactionBuilder(new Account(readSource.publicKey(), "0"), { fee: BASE_FEE, networkPassphrase: deployment.networkPassphrase })
    .addOperation(new Contract(contractId).call(method, ...scArgs))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error.split("\n")[0]}`);
  return scValToNative(sim.result.retval);
}

/** Reads a value from the coin-flip contract's instance storage, keyed by DataKey variant. */
async function readInstanceValue(contractId, variant) {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const { entries } = await server.getLedgerEntries(key);
  assert(entries.length === 1, `contract ${contractId} has no instance on this network`);
  const storage = entries[0].val.contractData().val().instance().storage() ?? [];
  for (const entry of storage) {
    const k = scValToNative(entry.key());
    if (Array.isArray(k) ? k[0] === variant : k === variant) return scValToNative(entry.val());
  }
  throw new Error(`instance storage has no ${variant}`);
}

async function submit(keypair, operation) {
  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: deployment.networkPassphrase })
    .addOperation(operation)
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  assert(sent.status === "PENDING" || sent.status === "DUPLICATE", `submission ${sent.status}`);
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, feeCharged: BigInt(res.resultXdr.feeCharged().toString()) };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transaction ${sent.hash} failed`);
    await sleep(1_000);
  }
  throw new Error(`transaction ${sent.hash} not confirmed in 30s`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest();

/** Mirrors random-generator `derive_result`. */
function deriveResult(seed, requestId, max) {
  const id = Buffer.alloc(8);
  id.writeBigUInt64BE(requestId);
  return sha256(Buffer.concat([seed, id])).readBigUInt64BE(0) % max;
}

// A throwaway keypair is also the source for read-only simulations.
const readSource = Keypair.random();

// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------

const timeoutSeconds = Number(args.timeout);
const apiUrl = args["api-url"].replace(/\/+$/, "");

deployment = await step("Load deployment manifest", () => {
  const path = resolve(args.deployment);
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  for (const field of ["rpcUrl", "networkPassphrase", "nativeToken"]) {
    assert(manifest[field], `${path} is missing ${field}`);
  }
  assert(manifest.contracts?.coinFlip && manifest.contracts?.randomGenerator, `${path} is missing contract ids`);
  return manifest;
}).then((m) => {
  console.log(`     coinFlip=${m.contracts.coinFlip} randomGenerator=${m.contracts.randomGenerator}`);
  return m;
});
server = new rpc.Server(deployment.rpcUrl, { allowHttp: deployment.rpcUrl.startsWith("http://") });
const { coinFlip, randomGenerator } = deployment.contracts;

await step("Deployed contracts exist on the network", async () => {
  for (const [name, id] of Object.entries({ coinFlip, randomGenerator })) {
    try {
      await server.getContractWasmByContractId(id);
    } catch {
      throw new Error(`${name} ${id} is not deployed on ${deployment.network ?? deployment.rpcUrl}`);
    }
  }
  return "both contracts found";
});

const config = {};
await step("Read coin-flip config (min wager, house edge)", async () => {
  config.minWager = BigInt(await readInstanceValue(coinFlip, "MinWager"));
  config.houseEdgeBps = BigInt(await readInstanceValue(coinFlip, "HouseEdgeBps"));
  return `minWager=${config.minWager} stroops, houseEdge=${config.houseEdgeBps} bps`;
});

const player = Keypair.random();
await step("Create and fund a throwaway player with Friendbot", async () => {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${player.publicKey()}`);
  assert(res.ok, `friendbot returned ${res.status}`);
  return player.publicKey();
});

const balanceOf = async () =>
  BigInt(await simulateRead(deployment.nativeToken, "balance", [new Address(player.publicKey()).toScVal()]));

const balanceBefore = await step("Record starting XLM balance", async () => {
  const b = await balanceOf();
  assert(b > 0n, "player balance is zero after funding");
  return b;
});

const gameId = randomBytes(8).readBigUInt64BE(0);
const bet = await step("Place a min-wager bet with a random game_id", async () => {
  const result = await submit(
    player,
    new Contract(coinFlip).call(
      "place_bet",
      new Address(player.publicKey()).toScVal(),
      nativeToScVal(HEADS, { type: "u32" }),
      nativeToScVal(config.minWager, { type: "i128" }),
      nativeToScVal(gameId, { type: "u64" }),
    ),
  );
  return result;
});
console.log(`     game_id=${gameId} tx=${bet.hash} fee=${bet.feeCharged}`);

const game = await step(`Oracle resolves the game within ${timeoutSeconds}s`, async () => {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  while (Date.now() < deadline) {
    const g = await simulateRead(coinFlip, "get_game", [nativeToScVal(gameId, { type: "u64" })]);
    if (g.resolved) return g;
    await sleep(5_000);
  }
  throw new Error("game still unresolved — is the oracle worker running?");
});
console.log(`     won=${game.won} payout=${game.payout}`);

await step("Payout matches the house-edge formula", () => {
  const wager = BigInt(game.wager);
  const expected = game.won ? 2n * wager - (wager * config.houseEdgeBps) / BASIS_POINTS : 0n;
  assert(BigInt(game.payout) === expected, `payout ${game.payout} != expected ${expected}`);
  return `payout ${game.payout}`;
});

await step("Player balance changed by exactly payout - wager - fees", async () => {
  const after = await balanceOf();
  const expected = balanceBefore - BigInt(game.wager) - bet.feeCharged + BigInt(game.payout);
  assert(after === expected, `balance ${after} != expected ${expected} (before ${balanceBefore})`);
  return `${balanceBefore} -> ${after}`;
});

await step("Revealed seed matches its commitment and recomputes the result", async () => {
  const entry = await simulateRead(randomGenerator, "get_result", [nativeToScVal(gameId, { type: "u64" })]);
  const seed = Buffer.from(entry.server_seed);
  assert(sha256(seed).equals(Buffer.from(entry.commitment)), "sha256(server_seed) != commitment");
  const recomputed = deriveResult(seed, gameId, BigInt(entry.max));
  assert(recomputed === BigInt(entry.result), `recomputed ${recomputed} != stored ${entry.result}`);
  assert(game.won === (BigInt(game.side) === recomputed), "settled win/loss does not follow from the result");
  return `result=${recomputed}`;
});

await step("Round appears in GET /api/games/recent", async () => {
  assert(apiUrl, "no --api-url (or SMOKE_API_URL) configured");
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/games/recent?limit=50`);
    assert(res.ok, `GET ${apiUrl}/games/recent returned ${res.status}`);
    const body = await res.text();
    if (body.includes(gameId.toString())) return "indexed";
    await sleep(5_000);
  }
  throw new Error(`game ${gameId} not listed by ${apiUrl}/games/recent after 60s`);
});

console.log("PASS coin-flip round smoke test");
