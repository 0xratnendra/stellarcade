"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Flame, Trophy, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "../../../src/components/ui/button";
import { EmptyState } from "../../../src/components/ui/empty-state";
import { PageHeader } from "../../../src/components/ui/page-header";
import { LeaderboardPrizeTicker } from "../../../src/components";
import { cn } from "../../../src/lib/utils";
import { useWalletStatus } from "../../../src/hooks/useWalletStatus";
import { useLeaderboard } from "../../../src/services/player-data";

const TIMEFRAMES = [
  { id: "weekly", label: "Weekly Epoch" },
  { id: "all_time", label: "All-Time" },
] as const;

type Timeframe = (typeof TIMEFRAMES)[number]["id"];

const PODIUM_MEDALS = ["🥇", "🥈", "🥉"];

function shortAddress(address: string, lead = 6) {
  return `${address.slice(0, lead)}…${address.slice(-4)}`;
}

export default function LeaderboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("weekly");
  const { address: connectedAddress } = useWalletStatus();
  const { items: entries, isLoading, error } = useLeaderboard();

  const hasEntries = entries.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-6"
    >
      <PageHeader
        icon={<Trophy />}
        title="Arcade Leaderboard"
        description="Track top-performing players across Coinflip Duels, Dice Rolls, and Tournament Brackets on Stellar."
        actions={
          <div
            role="group"
            aria-label="Leaderboard timeframe"
            className="flex rounded-lg border border-border bg-background/50 p-0.5"
          >
            {TIMEFRAMES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTimeframe(option.id)}
                aria-pressed={timeframe === option.id}
                disabled={!hasEntries}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  timeframe === option.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <section className="rounded-2xl border border-border bg-card/60 p-6 text-center text-sm text-destructive backdrop-blur-sm">
          {error}
        </section>
      ) : !hasEntries ? (
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
          {isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 pt-8 pb-2 text-muted-foreground">
              <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-xs font-medium">Loading rankings from network…</p>
            </div>
          )}
          <EmptyState
            size="lg"
            icon={Trophy}
            title="Nobody on the board yet"
            body="The leaderboard ranks players by net winnings once rounds start settling on-chain. No rounds have settled, so there is nothing to rank — be the first name on it."
            action={
              <Button asChild size="sm" variant="brand">
                <Link href="/games">Play the first round</Link>
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <LeaderboardPrizeTicker
            prizePoolXlm={entries.reduce((sum, player) => sum + player.totalVolumeXlm, 0) * 0.1}
            targetResetTs={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}
            topPrizes={[50, 30, 20]}
          />

          {/* Podium */}
          <div className="grid gap-4 md:grid-cols-3">
            {entries.slice(0, 3).map((player, idx) => (
              <motion.article
                key={player.address}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className={cn(
                  "flex flex-col items-center rounded-2xl border p-6 text-center backdrop-blur-sm",
                  idx === 0
                    ? "border-primary bg-linear-to-br from-primary/12 to-background/60 shadow-[0_0_40px_-12px_var(--accent-glow)]"
                    : "border-border bg-card/60",
                )}
              >
                <span className="text-4xl" aria-hidden>
                  {PODIUM_MEDALS[idx]}
                </span>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">
                  {player.username}
                </h2>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {shortAddress(player.address)}
                </p>

                <dl className="mt-5 grid w-full grid-cols-2 gap-3 border-t border-border/60 pt-4">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Wins</dt>
                    <dd className="font-mono text-lg font-bold tabular-nums text-foreground">
                      {player.wins}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Volume</dt>
                    <dd className="font-mono text-lg font-bold tabular-nums text-primary">
                      {player.totalVolumeXlm.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </motion.article>
            ))}
          </div>

          {/* Full table */}
          <section
            aria-labelledby="ranked-players-heading"
            className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm"
          >
            <header className="border-b border-border/70 px-5 py-4">
              <h2 id="ranked-players-heading" className="text-sm font-semibold text-foreground">
                Top Ranked Players
              </h2>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th scope="col" className="px-5 py-3 text-left font-semibold">Rank</th>
                    <th scope="col" className="px-5 py-3 text-left font-semibold">Player</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Wins</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Win Rate</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {entries.map((player) => {
                    const isConnected =
                      Boolean(connectedAddress) &&
                      player.address.toLowerCase() === connectedAddress?.toLowerCase();
                    return (
                      <tr
                        key={player.address}
                        className={cn(
                          "transition-colors hover:bg-primary/5",
                          isConnected && "bg-primary/10 border-l-4 border-l-primary font-medium",
                        )}
                      >
                        <td className="px-5 py-3.5">
                          <span
                            className={cn(
                              "inline-flex size-7 items-center justify-center rounded-md font-mono text-xs font-bold",
                              player.rank <= 3
                                ? "bg-primary/15 text-primary"
                                : "bg-background/60 text-muted-foreground",
                            )}
                          >
                            {player.rank}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground">{player.username}</p>
                            {isConnected && (
                              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                                YOU
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {shortAddress(player.address, 8)}
                          </p>
                        </td>
                      <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Flame className="size-3.5 text-amber-400" aria-hidden />
                          {player.wins}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-primary">
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="size-3.5" aria-hidden />
                          {player.winRate}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold tabular-nums text-foreground">
                        {player.totalVolumeXlm.toLocaleString()} XLM
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </motion.div>
  );
}
