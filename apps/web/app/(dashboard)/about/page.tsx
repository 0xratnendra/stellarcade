"use client";

import React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Scale,
  Code2,
  Layers,
  Zap,
  Lock,
  Trophy,
  ExternalLink,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";

import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { PageHeader } from "../../../src/components/ui/page-header";

const ECOSYSTEM_REPOS = [
  {
    name: "stellarcade",
    title: "Web App & Soroban Contracts",
    description:
      "The full Next.js frontend experience and comprehensive Rust Soroban smart contract catalog powering on-chain arcade rooms, game logic, and prize vaults.",
    badge: "Next.js • Soroban Rust",
    github: "https://github.com/theblockcade/stellarcade",
  },
  {
    name: "stellarcade-sdk",
    title: "TypeScript SDK & Client Verifier",
    description:
      "Universal TypeScript SDK providing client-side WebCrypto fairness verification, Freighter wallet connectors, RPC helpers, and typed game APIs.",
    badge: "TypeScript • WebCrypto",
    github: "https://github.com/theblockcade/stellarcade-sdk",
  },
  {
    name: "stellarcade-arbiter",
    title: "High-Throughput Settlement Arbiter",
    description:
      "Deterministic off-chain settlement service managing commit-reveal cycles, ledger hash commitments, and hash-chained dispute resolution audit trails.",
    badge: "TypeScript • Node.js",
    github: "https://github.com/theblockcade/stellarcade-arbiter",
  },
  {
    name: "stellarcade-bot",
    title: "Community Discord & Telegram Bot",
    description:
      "Automated chat interfaces supporting non-custodial Ed25519 challenge-response wallet linking, real-time leaderboard queries, and quest tracking.",
    badge: "Telegram • Discord • Ed25519",
    github: "https://github.com/theblockcade/stellarcade-bot",
  },
];

const MISSION_PILLARS = [
  {
    icon: ShieldCheck,
    title: "Provably Fair by Design",
    body: "Every round outcome is derived on-chain by the random-generator contract's commit-reveal scheme: the oracle's seed is hashed and committed before your bet, and the result follows from that seed and the round id alone.",
  },
  {
    icon: Lock,
    title: "Zero Custody",
    body: "We never take custody of your keys or funds. Connect your self-custodied Freighter wallet and sign transactions only when initiating rounds or claiming prizes.",
  },
  {
    icon: Zap,
    title: "Soroban Speed & Low Fees",
    body: "Built directly on Stellar's Soroban smart contract platform, enabling 5-second ledger closes and fractions of a cent per transaction without layer-2 complexity.",
  },
  {
    icon: Trophy,
    title: "On-Chain Reward Pools",
    body: "Tournament prize pools and daily quest rewards are held in smart contracts and distributed automatically according to immutable rules.",
  },
];

const FAIRNESS_STEPS = [
  {
    step: "Step 1: Commit",
    title: "Oracle commits a hidden seed",
    body: "Before any bet exists, the oracle publishes sha256(seed) to the random-generator contract. The seed itself stays hidden — SHA-256 cannot be reversed to recover it.",
  },
  {
    step: "Step 2: Lock",
    title: "Your bet claims that commitment",
    body: "place_bet pops the oldest commitment from the on-chain queue and binds it to your game id in the same transaction. With an empty queue the bet fails, so no round runs without a commitment.",
  },
  {
    step: "Step 3: Reveal",
    title: "The contract derives the result",
    body: "fulfill_random re-hashes the revealed seed and rejects it unless it equals the commitment, then computes sha256(seed ‖ round id) — first 8 bytes as big-endian, mod 2. 0 is Heads, 1 is Tails.",
  },
  {
    step: "Step 4: Verify",
    title: "Recompute it yourself",
    body: "Open the verifier with a round id: it reruns the contract's exact formula in your browser and checks the seed, the commitment and the stored result. No server involved.",
  },
];

function SectionIntro({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
        <Icon className="size-5.5 text-primary" aria-hidden />
        {title}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
    </div>
  );
}

export default function AboutPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-8"
    >
      <PageHeader
        eyebrow={
          <Badge variant="outline" className="gap-1.5 border-primary/40 text-primary">
            <Layers className="size-3" aria-hidden />
            Ecosystem Architecture
          </Badge>
        }
        title="About StellarCade"
        description="A decentralized, provably fair gaming ecosystem built natively on Stellar and Soroban. Engineered for complete transparency, instant settlement, and non-custodial play."
      />

      <section className="flex flex-col gap-4">
        <SectionIntro
          icon={CheckCircle2}
          title="Core Engineering Principles"
          description="How StellarCade guarantees trustless fairness and player sovereignty across all game modes."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {MISSION_PILLARS.map(({ icon: Icon, title, body }) => (
            <article
              key={title}
              className="rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm transition-colors hover:border-primary/40"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-3 text-base font-bold text-foreground">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm">
        <SectionIntro
          icon={Scale}
          title="How Provable Fairness Works"
          description="Commit-reveal, exactly as the random-generator and coin-flip contracts implement it."
        />

        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {FAIRNESS_STEPS.map((item) => (
            <li key={item.step} className="rounded-xl border border-border/60 bg-background/50 p-5">
              <span className="block text-[11px] font-bold tracking-[0.12em] text-primary uppercase">
                {item.step}
              </span>
              <h3 className="mt-1 text-base font-bold text-foreground">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ol>

        <div className="rounded-xl border border-border/60 bg-background/50 p-5" data-testid="fairness-limits">
          <span className="block text-[11px] font-bold tracking-[0.12em] text-foreground uppercase">
            What it does not cover
          </span>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Commit-reveal fixes the seed before your bet; it cannot force the oracle to reveal it. A round the
            oracle never fulfils stays pending — after <span className="font-mono">RefundTimeoutLedgers</span>{" "}
            (17,280 ledgers, about 24 hours) you call{" "}
            <span className="font-mono">cancel_stale_bet</span> to reclaim your full wager, and a refunded game
            can never be resolved afterwards, so you get a refund or a payout, never both. The oracle also knows
            the seeds it commits; only SHA-256 preimage resistance keeps them secret from everyone else.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="sm" variant="brand">
            <Link href="/verify">
              Launch Interactive Fairness Verifier
              <ArrowRight />
            </Link>
          </Button>
          <Link
            href="/verify#how-it-works"
            className="text-xs font-semibold text-primary underline transition-opacity hover:opacity-80"
          >
            Read the four steps in plain language
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionIntro
          icon={Code2}
          title="The StellarCade Family Repositories"
          description="The four specialized codebases that comprise the open-source StellarCade ecosystem."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {ECOSYSTEM_REPOS.map((repo) => (
            <article
              key={repo.name}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm transition-colors hover:border-primary/40"
            >
              <div>
                <Badge variant="outline" className="rounded-md border-primary/30 text-primary">
                  {repo.badge}
                </Badge>
                <h3 className="mt-2.5 text-base font-bold text-foreground">{repo.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {repo.description}
                </p>
              </div>

              <a
                href={repo.github}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-primary transition-opacity hover:opacity-80"
              >
                github.com/theblockcade/{repo.name}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </article>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
