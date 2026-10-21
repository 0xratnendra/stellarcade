import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { CleanableSubentry } from "../utils/account-hygiene";

export interface CleanupConfig {
  horizonUrl: string;
  networkPassphrase: string;
}

export interface CleanupResult {
  txHash: string;
  reclaimedXlm: number;
}

/** Reads the env and returns a CleanupConfig, throws if any var is missing. */
export function getCleanupConfig(): CleanupConfig {
  const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
  const missing = [
    !horizonUrl && "NEXT_PUBLIC_HORIZON_URL",
    !networkPassphrase && "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Account cleanup is not configured: set ${missing.join(", ")}`);
  }
  return { horizonUrl: horizonUrl!, networkPassphrase: networkPassphrase! };
}

/**
 * Builds a single Stellar transaction that removes the given subentries from
 * `accountId`.  No signing or submission is performed here.
 *
 * Supported subentry types:
 * - `trustline`   → `changeTrust` with limit 0
 * - `signer`      → `setOptions` with signer weight 0
 * - `data_entry`  → `manageData` with null value
 *
 * @throws {Error} for unconfigured env or unsupported subentry types.
 */
export async function buildCleanupTransaction(
  accountId: string,
  subentries: CleanableSubentry[],
  networkPassphrase: string,
  deps: { horizon?: Horizon.Server } = {},
): Promise<Transaction> {
  const horizon = deps.horizon ?? new Horizon.Server(
    process.env.NEXT_PUBLIC_HORIZON_URL ?? (() => { throw new Error("NEXT_PUBLIC_HORIZON_URL not set"); })()
  );
  const accountRecord = await horizon.loadAccount(accountId);
  const account = new Account(accountRecord.id, accountRecord.sequence);

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  });

  for (const subentry of subentries) {
    switch (subentry.type) {
      case "trustline": {
        if (!subentry.assetCode || !subentry.assetIssuer) {
          throw new Error(`Trustline subentry ${subentry.id} is missing assetCode or assetIssuer`);
        }
        const asset =
          subentry.assetCode === "XLM"
            ? Asset.native()
            : new Asset(subentry.assetCode, subentry.assetIssuer);
        builder.addOperation(Operation.changeTrust({ asset, limit: "0" }));
        break;
      }
      case "signer": {
        builder.addOperation(
          Operation.setOptions({
            signer: { ed25519PublicKey: subentry.id, weight: 0 },
          }),
        );
        break;
      }
      case "data_entry": {
        builder.addOperation(Operation.manageData({ name: subentry.id, value: null }));
        break;
      }
      default: {
        throw new Error(`Unsupported subentry type: ${(subentry as CleanableSubentry).type}`);
      }
    }
  }

  return builder.setTimeout(180).build();
}

/**
 * Returns the difference in available XLM balance between two Horizon account
 * snapshots, expressed as a positive number when the second has more available
 * XLM than the first (i.e. reserves were released).
 */
export function calculateReclaimedXlm(
  before: Horizon.AccountResponse,
  after: Horizon.AccountResponse,
): number {
  const xlmBefore = Number(
    before.balances.find((b) => b.asset_type === "native")?.balance ?? "0",
  );
  const xlmAfter = Number(
    after.balances.find((b) => b.asset_type === "native")?.balance ?? "0",
  );
  return Math.max(0, xlmAfter - xlmBefore);
}
