"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Portfolio, type PortfolioState } from "../../../src/components/Portfolio";
import { TokenSwapRateCalculator } from "../../../src/components";
import { useWalletStatus } from "../../../src/hooks/useWalletStatus";
import { createProfileApiClient } from "../../../src/services/profile-service";
import { getBadgeClientConfig, getPlayerBadges } from "../../../src/services/badge-client";

const EMPTY_SECTION = { status: "ready" as const, items: [] };

/**
 * Thin Next route wrapper around the ported Portfolio component. The
 * original app (frontend/src/App.tsx) wired onOpenWallet/onBrowseRewards/
 * onBrowseCollectibles to react-router's useNavigate; here they go through
 * next/navigation's useRouter instead. Portfolio itself stays a plain,
 * router-agnostic component (see MIGRATION.md) so it's independently
 * testable without a routing context.
 *
 * The wallet balance is the one section actually wired to real data —
 * Horizon on-chain balances via GET /wallet/:address/balance. Rewards and
 * collectibles have no backend behind them yet, so they render Portfolio's
 * own honest "nothing yet" empty state rather than fabricated numbers.
 */
export default function PortfolioPage() {
  const router = useRouter();
  const wallet = useWalletStatus();
  const [walletSection, setWalletSection] = useState<PortfolioState["wallet"]>(EMPTY_SECTION);
  const [badgesSection, setBadgesSection] = useState<PortfolioState["collectibles"]>(EMPTY_SECTION);
  const badgesConfigured = getBadgeClientConfig() !== null;

  useEffect(() => {
    if (!wallet.capabilities.isConnected || !wallet.address) {
      setWalletSection(EMPTY_SECTION);
      return;
    }

    let cancelled = false;
    setWalletSection({ status: "loading", items: [] });

    const client = createProfileApiClient();
    client.getWalletBalance(wallet.address).then((result) => {
      if (cancelled) return;

      if (!result.success) {
        setWalletSection({ status: "error", items: [], errorMessage: result.error.message });
        return;
      }

      const xlm = Number.parseFloat(result.data.balances.XLM ?? "0");
      setWalletSection({
        status: "ready",
        items: [
          {
            availableBalance: Number.isNaN(xlm) ? 0 : xlm,
            networkLabel: wallet.network ?? "Stellar Testnet",
          },
        ],
      });
    });

    return () => {
      cancelled = true;
    };
  }, [wallet.capabilities.isConnected, wallet.address, wallet.network]);

  useEffect(() => {
    if (!badgesConfigured || !wallet.capabilities.isConnected || !wallet.address) {
      setBadgesSection(EMPTY_SECTION);
      return;
    }

    let cancelled = false;
    setBadgesSection({ status: "loading", items: [] });

    getPlayerBadges(wallet.address).then((badges) => {
      if (cancelled) return;
      setBadgesSection({ status: "ready", items: badges });
    }).catch((err: unknown) => {
      if (cancelled) return;
      setBadgesSection({
        status: "error",
        items: [],
        errorMessage: err instanceof Error ? err.message : "Failed to load badges.",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [badgesConfigured, wallet.capabilities.isConnected, wallet.address]);

  const state: PortfolioState = {
    wallet: walletSection,
    rewards: EMPTY_SECTION,
    collectibles: badgesConfigured ? badgesSection : EMPTY_SECTION,
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Portfolio
        state={state}
        onOpenWallet={() => router.push("/profile")}
        onBrowseRewards={() => router.push("/rewards")}
        onBrowseCollectibles={() => router.push("/quests")}
      />

      <section
        aria-labelledby="token-swap-heading"
        className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm"
      >
        <div className="mb-4">
          <h2 id="token-swap-heading" className="text-base font-bold text-foreground">
            Instant Token Swap Calculator
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Preview real-time exchange rates, estimated slippage, and routing fees for Stellar asset swaps.
          </p>
        </div>
        <TokenSwapRateCalculator
          fromSymbol="XLM"
          toSymbol="USDC"
          exchangeRate={0.12}
          feePercent={0.3}
          onSwap={(quote, amount) => {
            // Swap preview callback
          }}
        />
      </section>
    </div>
  );
}
