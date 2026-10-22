import {
  Account,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { CollectiblePortfolioItem } from "../components/Portfolio";

/** Injected source for read-only simulations — balance is irrelevant. */
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export interface BadgeClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/** Reads the env and returns a BadgeClientConfig. Returns null when unconfigured. */
export function getBadgeClientConfig(): BadgeClientConfig | null {
  const contractId = process.env.NEXT_PUBLIC_ACHIEVEMENT_BADGE_CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  if (!contractId || !rpcUrl || !networkPassphrase) return null;
  return { contractId, rpcUrl, networkPassphrase };
}

/** The slice of `rpc.Server` badge reads need; injectable for tests. */
export interface BadgeReadRpc {
  simulateTransaction(tx: ReturnType<TransactionBuilder["build"]>): Promise<rpc.Api.SimulateTransactionResponse>;
}

async function simulateRead(
  server: BadgeReadRpc,
  config: BadgeClientConfig,
  method: string,
  args: ReturnType<typeof nativeToScVal>[],
): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(READ_ONLY_SOURCE, "0"), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(new Contract(config.contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Badge contract error: ${sim.error}`);
  }
  if (!sim.result) {
    throw new Error(`${method} returned no result`);
  }
  return scValToNative(sim.result.retval);
}

/**
 * Reads the player's achievement badges from the on-chain badge contract via
 * read-only simulation.  Returns an empty array when the contract is not
 * configured; throws on network or contract errors.
 *
 * @param playerAddress - The Stellar address of the player (G…).
 * @param deps - Optional overrides for the RPC server and config (for tests).
 */
export async function getPlayerBadges(
  playerAddress: string,
  deps: { server?: BadgeReadRpc; config?: BadgeClientConfig | null } = {},
): Promise<CollectiblePortfolioItem[]> {
  const config = "config" in deps ? deps.config : getBadgeClientConfig();
  if (!config) return [];

  const server: BadgeReadRpc = deps.server ?? new rpc.Server(config.rpcUrl, { allowHttp: false });

  const badgeIds = (await simulateRead(server, config, "badges_of", [
    nativeToScVal(playerAddress, { type: "address" }),
  ])) as bigint[];

  if (!Array.isArray(badgeIds) || badgeIds.length === 0) return [];

  const badges = await Promise.all(
    badgeIds.map(async (id) => {
      const summary = (await simulateRead(server, config, "badge_summary", [
        nativeToScVal(id, { type: "u64" }),
      ])) as Record<string, unknown>;

      if (!summary.found) return null;

      return {
        id: String(id),
        name: String(summary.title ?? `Badge #${id}`),
        rarity: "achievement",
      } satisfies CollectiblePortfolioItem;
    }),
  );

  return badges.filter((b): b is CollectiblePortfolioItem => b !== null);
}
