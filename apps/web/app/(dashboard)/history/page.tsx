"use client";

import React from "react";
import Link from "next/link";
import { History, ShieldCheck, Coins, Dices, Trophy } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "../../../src/components/ui/button";
import { EmptyState } from "../../../src/components/ui/empty-state";
import { PageHeader } from "../../../src/components/ui/page-header";
import { StatTile } from "../../../src/components/ui/stat-tile";
import { cn } from "../../../src/lib/utils";
import { useSettledRounds, type SettledRound } from "../../../src/services/player-data";

const GAME_ICON: Record<SettledRound["gameType"], React.ElementType> = {
  coinflip: Coins,
  dice: Dices,
  gauntlet: Trophy,
};

export default function HistoryPage() {
  const { items: rounds, isLoading, error } = useSettledRounds();

  const settled = rounds.length;
  const hasRounds = settled > 0;
  const wins = rounds.filter((m) => m.outcome === "WIN").length;
  const netXlm = rounds.reduce((sum, m) => sum + m.payoutXlm - m.wagerXlm, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-6"
    >
      <PageHeader
        icon={<History />}
        title="Match History & Proofs"
        description="Review your on-chain gameplay history and independently verify the SHA-256 commit-reveal proof for any settled round."
        actions={
          <Button asChild variant="brand" size="sm">
            <Link href="/verify">
              <ShieldCheck />
              Open Fairness Verifier
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Rounds settled"
          value={String(settled)}
          empty={!hasRounds}
          caption={hasRounds ? "In this window" : "Nothing settled on this wallet"}
        />
        <StatTile
          label="Win rate"
          value={`${hasRounds ? Math.round((wins / settled) * 100) : 0}%`}
          empty={!hasRounds}
          trend={hasRounds && wins * 2 >= settled ? "up" : "down"}
          caption={hasRounds ? `${wins} of ${settled} rounds won` : "Needs at least one round"}
        />
        <StatTile
          label="Net result"
          value={`${netXlm >= 0 ? "+" : ""}${netXlm} XLM`}
          empty={!hasRounds}
          trend={netXlm > 0 ? "up" : netXlm < 0 ? "down" : "flat"}
          caption={hasRounds ? "Payout minus wagers" : "Nothing wagered yet"}
        />
      </div>

      <section
        aria-labelledby="match-history-heading"
        className="overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-sm"
      >
        <header className="border-b border-border/70 px-5 py-4">
          <h2 id="match-history-heading" className="text-sm font-semibold text-foreground">
            Settled Rounds
          </h2>
        </header>

        {error ? (
          <div className="p-6 text-center text-sm text-destructive">
            {error}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm font-medium">Loading settled rounds from network…</p>
          </div>
        ) : !hasRounds ? (
          <EmptyState
            size="lg"
            icon={History}
            title="No rounds settled yet"
            body="Every round you play lands here with its commit-reveal proof attached, so you can re-verify any result yourself. Nothing has settled on this wallet so far."
            action={
              <Button asChild size="sm" variant="brand">
                <Link href="/games">Play a game</Link>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className="border-b border-border/70 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Game</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Wager</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Result</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Payout</th>
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Settled</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Cryptographic Audit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {rounds.map((m) => {
                  const Icon = GAME_ICON[m.gameType];
                  const isWin = m.outcome === "WIN";
                  return (
                    <tr key={m.id} className="transition-colors hover:bg-primary/5">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{m.game}</p>
                            <p className="font-mono text-[11px] text-muted-foreground">
                              ID: {m.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-foreground">
                        {m.wagerXlm} XLM
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wider",
                            isWin
                              ? "bg-emerald-400/10 text-emerald-400"
                              : "bg-rose-400/10 text-rose-400",
                          )}
                        >
                          {m.outcome}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "px-5 py-3.5 text-right font-mono font-bold tabular-nums",
                          isWin ? "text-emerald-400" : "text-muted-foreground",
                        )}
                      >
                        {m.payoutXlm > 0 ? `+${m.payoutXlm} XLM` : "0 XLM"}
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">
                        {new Date(m.settledAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/verify?serverSeed=${m.serverSeed}&commitHash=${m.commitHash}&clientSeed=${m.clientSeed}&nonce=${m.nonce}&rangeSize=${m.rangeSize}`}
                          >
                            <ShieldCheck className="text-primary" />
                            Verify Proof
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </motion.div>
  );
}
