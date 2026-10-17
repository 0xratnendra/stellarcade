/**
 * Coin-flip contract client.
 *
 * Places real bets on the deployed coin-flip contract: builds the
 * `place_bet(player, side, wager, game_id)` call, prepares it against Soroban
 * RPC (simulation + resource assembly), has Freighter sign it, submits it and
 * polls until the network confirms it. The outcome is decided on-chain later,
 * when the oracle fulfils the randomness request — nothing here picks a result.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import defaultFreighterAdapter from "./freighter-adapter";
import { toAppError } from "../utils/errorMapper";
import type { AppError } from "../types/errors";

export const STROOPS_PER_XLM = 10_000_000n;
const XLM_DECIMALS = 7;
const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

/** coin-flip `Error::GameAlreadyExists`. */
const GAME_ALREADY_EXISTS = 6;

/**
 * Soroban simulations need a source account but never touch it; this is the
 * all-zero account the SDK's generated clients use for read-only calls.
 */
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export type CoinFlipSideValue = 0 | 1;

export interface CoinFlipConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/** The slice of `rpc.Server` the client uses; injectable for tests. */
export interface CoinFlipRpc {
  getAccount(address: string): Promise<Account>;
  prepareTransaction(tx: Transaction): Promise<Transaction>;
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export interface CoinFlipWallet {
  signTransaction(
    xdr: string,
    opts?: { network?: string; networkPassphrase?: string },
  ): Promise<string>;
}

export interface PlaceBetParams {
  player: string;
  side: CoinFlipSideValue;
  wagerXlm: string;
}

export interface PlaceBetDeps {
  rpc?: CoinFlipRpc;
  wallet?: CoinFlipWallet;
  config?: CoinFlipConfig;
  /** Overridable for tests; defaults to a crypto-random u64. */
  generateGameId?: () => bigint;
  /** Overridable for tests so polling doesn't wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface PlaceBetResult {
  gameId: bigint;
  txHash: string;
}

/** Thrown by placeBet; `appError` carries the user-facing mapped message. */
export class CoinFlipBetError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = "CoinFlipBetError";
    this.appError = appError;
  }
}

/**
 * Reads the coin-flip deployment settings. NEXT_PUBLIC_* values must be read
 * with static property access — Next.js only inlines those into the browser
 * bundle, so a dynamic `process.env[name]` lookup would be undefined there.
 */
export function getCoinFlipConfig(): CoinFlipConfig {
  const contractId = process.env.NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  const missing = [
    !contractId && "NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID",
    !rpcUrl && "NEXT_PUBLIC_SOROBAN_RPC_URL",
    !networkPassphrase && "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Coin flip is not configured: set ${missing.join(", ")}`);
  }
  return {
    contractId: contractId as string,
    rpcUrl: rpcUrl as string,
    networkPassphrase: networkPassphrase as string,
  };
}

export function createCoinFlipRpc(config: CoinFlipConfig): rpc.Server {
  return new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith("http://"),
  });
}

/**
 * Converts a decimal XLM string to stroops using integer maths only, so no
 * floating-point rounding can change the wager. Accepts up to 7 decimals.
 */
export function xlmToStroops(xlm: string): bigint {
  const trimmed = xlm.trim();
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(trimmed);
  if (!match) {
    throw new RangeError(
      `Invalid XLM amount "${xlm}": use a positive decimal with at most ${XLM_DECIMALS} decimal places`,
    );
  }
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(XLM_DECIMALS, "0"));
  const stroops = whole * STROOPS_PER_XLM + fraction;
  if (stroops <= 0n) {
    throw new RangeError("Wager must be greater than zero");
  }
  if (stroops > I128_MAX) {
    throw new RangeError("Wager is too large");
  }
  return stroops;
}

/** Formats a stroop amount as XLM without floating point, trimming zeros. */
export function stroopsToXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const fraction = (abs % STROOPS_PER_XLM).toString().padStart(XLM_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** A uniformly random u64 game id from the Web Crypto CSPRNG. */
export function randomGameId(): bigint {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

/** Arguments for `place_bet(player: Address, side: u32, wager: i128, game_id: u64)`. */
export function buildPlaceBetArgs(
  player: string,
  side: CoinFlipSideValue,
  wagerStroops: bigint,
  gameId: bigint,
): xdr.ScVal[] {
  if (gameId < 0n || gameId > U64_MAX) {
    throw new RangeError("game_id must fit in a u64");
  }
  return [
    new Address(player).toScVal(),
    nativeToScVal(side, { type: "u32" }),
    nativeToScVal(wagerStroops, { type: "i128" }),
    nativeToScVal(gameId, { type: "u64" }),
  ];
}

function contractErrorCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/.exec(message);
  return match ? Number(match[1]) : null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForConfirmation(
  server: CoinFlipRpc,
  hash: string,
  sleep: (ms: number) => Promise<void>,
  intervalMs: number,
  maxAttempts: number,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await server.getTransaction(hash);
    if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return response;
    }
    if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
      const diagnostics = (response.diagnosticEventsXdr ?? []).map((e) => e.toXDR("base64")).join(",");
      throw new Error(`Transaction ${hash} failed on-chain ${diagnostics}`.trim());
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for transaction ${hash} to confirm`);
}

/**
 * Places a coin-flip bet and resolves once the transaction is confirmed. The
 * returned game is pending: its outcome arrives in a later oracle transaction.
 */
export async function placeBet(
  params: PlaceBetParams,
  deps: PlaceBetDeps = {},
): Promise<PlaceBetResult> {
  try {
    if (params.side !== 0 && params.side !== 1) {
      throw new RangeError("side must be 0 (heads) or 1 (tails)");
    }
    const config = deps.config ?? getCoinFlipConfig();
    const server = deps.rpc ?? createCoinFlipRpc(config);
    const wallet = deps.wallet ?? defaultFreighterAdapter;
    const generateGameId = deps.generateGameId ?? randomGameId;
    const sleep = deps.sleep ?? defaultSleep;
    const wager = xlmToStroops(params.wagerXlm);
    const contract = new Contract(config.contractId);

    const prepare = async (gameId: bigint) => {
      const account = await server.getAccount(params.player);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(contract.call("place_bet", ...buildPlaceBetArgs(params.player, params.side, wager, gameId)))
        .setTimeout(60)
        .build();
      // prepareTransaction simulates the call (surfacing contract errors such
      // as WagerTooLow before anything is signed) and attaches the footprint
      // and resource fees the simulation reports.
      return server.prepareTransaction(tx);
    };

    let gameId = generateGameId();
    let prepared: Transaction;
    try {
      prepared = await prepare(gameId);
    } catch (error) {
      // A random u64 collision is vanishingly rare, but the contract rejects
      // reuse, so pick a fresh id and try exactly once more.
      if (contractErrorCode(error) !== GAME_ALREADY_EXISTS) throw error;
      gameId = generateGameId();
      prepared = await prepare(gameId);
    }

    const signedXdr = await wallet.signTransaction(prepared.toXDR(), {
      networkPassphrase: config.networkPassphrase,
    });
    const signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase) as Transaction;

    const sent = await server.sendTransaction(signed);
    if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
      const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
      throw new Error(`Transaction rejected by the network: ${detail}`);
    }

    await waitForConfirmation(
      server,
      sent.hash,
      sleep,
      deps.pollIntervalMs ?? 1_000,
      deps.maxPollAttempts ?? 30,
    );
    return { gameId, txHash: sent.hash };
  } catch (error) {
    throw new CoinFlipBetError(toAppError(error, undefined, { contract: "coin_flip" }));
  }
}

/** On-chain `Game` as returned by `get_game`. */
export interface CoinFlipGameState {
  player: string;
  side: number;
  wager: bigint;
  resolved: boolean;
  won: boolean;
  payout: bigint;
  /** Present once the contract records refunds (stale-bet cancellation). */
  refunded?: boolean;
}

/** The slice of `rpc.Server` read-only contract calls need. */
export interface CoinFlipReadRpc {
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
}

/** Runs a read-only contract call through simulation; nothing is signed. */
export async function simulateRead(
  server: CoinFlipReadRpc,
  config: Pick<CoinFlipConfig, "networkPassphrase">,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(sim.error);
  }
  if (!sim.result) {
    throw new Error(`${method} returned no result`);
  }
  return scValToNative(sim.result.retval);
}

/** Reads a game via `get_game(game_id)`. */
export async function getGame(
  server: CoinFlipReadRpc,
  config: CoinFlipConfig,
  gameId: bigint,
): Promise<CoinFlipGameState> {
  const raw = (await simulateRead(server, config, config.contractId, "get_game", [
    nativeToScVal(gameId, { type: "u64" }),
  ])) as Record<string, unknown>;
  return {
    player: String(raw.player),
    side: Number(raw.side),
    wager: BigInt(raw.wager as bigint),
    resolved: Boolean(raw.resolved),
    won: Boolean(raw.won),
    payout: BigInt(raw.payout as bigint),
    refunded: raw.refunded === undefined ? undefined : Boolean(raw.refunded),
  };
}

/** random-generator `FulfilledEntry`, as returned by `get_result`. */
export interface FulfilledRandomness {
  max: bigint;
  serverSeed: string;
  commitment: string;
  result: bigint;
}

/** Address of the random-generator contract coin flip requests randomness from. */
export function getRandomGeneratorContractId(): string {
  const id = process.env.NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID;
  if (!id) {
    throw new Error("Randomness verification is not configured: set NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID");
  }
  return id;
}

function bytesToHex(value: unknown): string {
  return Array.from(value as Uint8Array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads the fulfilled randomness for a request via `get_result(request_id)`. */
export async function getRandomResult(
  server: CoinFlipReadRpc,
  config: Pick<CoinFlipConfig, "networkPassphrase">,
  randomGeneratorId: string,
  requestId: bigint,
): Promise<FulfilledRandomness> {
  const raw = (await simulateRead(server, config, randomGeneratorId, "get_result", [
    nativeToScVal(requestId, { type: "u64" }),
  ])) as Record<string, unknown>;
  return {
    max: BigInt(raw.max as bigint),
    serverSeed: bytesToHex(raw.server_seed),
    commitment: bytesToHex(raw.commitment),
    result: BigInt(raw.result as bigint),
  };
}

export interface CoinFlipEventsRpc {
  getLatestLedger(): Promise<{ sequence: number }>;
  getEvents(request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
}

/** How far back to look for the resolution event (~14h at 5s ledgers). */
const RESOLUTION_LOOKBACK_LEDGERS = 10_000;

/**
 * Finds the transaction that resolved a game from its `bet_resolved` event
 * (topics: event name, game_id, player). Returns null when RPC no longer
 * retains the event — callers then show no link rather than a guessed one.
 */
export async function findResolutionTxHash(
  server: CoinFlipEventsRpc,
  config: CoinFlipConfig,
  gameId: bigint,
): Promise<string | null> {
  const latest = await server.getLatestLedger();
  const response = await server.getEvents({
    startLedger: Math.max(1, latest.sequence - RESOLUTION_LOOKBACK_LEDGERS),
    filters: [
      {
        type: "contract",
        contractIds: [config.contractId],
        topics: [
          [
            nativeToScVal("bet_resolved", { type: "symbol" }).toXDR("base64"),
            nativeToScVal(gameId, { type: "u64" }).toXDR("base64"),
            "*",
          ],
        ],
      },
    ],
    limit: 1,
  });
  return response.events[0]?.txHash ?? null;
}
