"use client";

import React from "react";
import Link from "next/link";
import { Award, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { EmptyState } from "../../../src/components/ui/empty-state";
import { PageHeader } from "../../../src/components/ui/page-header";
import { cn } from "../../../src/lib/utils";
import { useQuests, type Quest } from "../../../src/services/player-data";

const CATEGORY_TONE: Record<Quest["category"], string> = {
  Daily: "border-blue-400/30 text-blue-300",
  Weekly: "border-purple-400/30 text-purple-300",
  Special: "border-amber-400/30 text-amber-300",
};

export default function QuestsPage() {
  const { items: loadedQuests, isLoading, error } = useQuests();

  const quests = loadedQuests;
  const hasQuests = quests.length > 0;

  // XP is only ever the sum of quests actually claimed.
  const totalEarnedXp = quests
    .filter((q) => q.claimed)
    .reduce((sum, q) => sum + q.xpReward, 0);
  const completedCount = quests.filter((q) => q.completed).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
    >
      <PageHeader
        icon={<Award />}
        title="Quests & Soulbound Badges"
        description="Complete gameplay milestones, accumulate XP, and mint non-transferable Soulbound NFT certificates (SBTs) on Soroban."
        actions={
          <div className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5">
            <Sparkles className="size-5 text-primary" aria-hidden />
            <div>
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Total Player XP
              </p>
              <p className="font-mono text-lg font-bold tabular-nums text-foreground">
                {totalEarnedXp.toLocaleString()} XP
              </p>
            </div>
          </div>
        }
      >
        {hasQuests ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-primary">{completedCount}</span>{" "}
            of {quests.length} quests completed.
          </p>
        ) : null}
      </PageHeader>

      {isLoading ? (
        <section className="rounded-2xl border border-border bg-card/60 p-12 text-center backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Loading quests…</p>
        </section>
      ) : error ? (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center backdrop-blur-sm">
          <p className="text-sm font-medium text-destructive">{error}</p>
        </section>
      ) : !hasQuests ? (
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm">
          <EmptyState
            size="lg"
            icon={Award}
            title="No quests available yet"
            body="Daily and weekly milestones will appear here once quest tracking goes live, awarding XP and Soulbound Badges minted on Soroban. None are running right now."
            action={
              <Button asChild size="sm" variant="brand">
                <Link href="/games">
                  Play a game
                  <ArrowRight />
                </Link>
              </Button>
            }
          />
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {quests.map((q, idx) => {
            const pct = Math.min(100, Math.round((q.progress / q.total) * 100));
            const isClaimed = q.claimed;
            const isClaimable = false; // XP/badge minting is coming soon; never show as claimable

            return (
              <motion.li
                key={q.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.06 }}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-5 rounded-2xl border bg-card/60 p-5 backdrop-blur-sm transition-colors",
                  isClaimable ? "border-primary/40" : "border-border",
                )}
              >
                <div className="min-w-0 flex-1 basis-80">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("rounded-md", CATEGORY_TONE[q.category])}
                    >
                      {q.category}
                    </Badge>
                    <span className="font-mono text-xs font-bold text-primary">
                      +{q.xpReward} XP
                    </span>
                  </div>

                  <h2 className="mt-2 text-base font-bold text-foreground">
                    {q.title}
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {q.desc}
                  </p>

                  <div className="mt-3 flex items-center gap-3">
                    <div
                      className="h-1.5 w-full max-w-50 overflow-hidden rounded-full bg-border"
                      role="progressbar"
                      aria-valuenow={q.progress}
                      aria-valuemin={0}
                      aria-valuemax={q.total}
                      aria-label={`${q.title} progress`}
                    >
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {q.progress} / {q.total}
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  {isClaimed ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                      <CheckCircle2 className="size-4" aria-hidden />
                      Claimed
                    </span>
                  ) : q.completed ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled
                      className="cursor-not-allowed opacity-75"
                    >
                      Coming soon
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/games">
                        Play Now
                        <ArrowRight />
                      </Link>
                    </Button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
