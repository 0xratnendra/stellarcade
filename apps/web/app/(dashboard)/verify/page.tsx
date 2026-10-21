"use client";

import React, { useState, useEffect, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
  Copy,
  Check,
  CheckCircle2,
  Dices,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { motion } from "framer-motion";

import { Badge } from "../../../src/components/ui/badge";
import { Button } from "../../../src/components/ui/button";
import { PageHeader } from "../../../src/components/ui/page-header";
import { cn } from "../../../src/lib/utils";
import {
  buildRoundReport,
  ROUND_PRESETS,
  type RoundReport,
} from "../../../src/utils/round-verifier";
import {
  createCoinFlipRpc,
  getCoinFlipConfig,
  getGame,
  getRandomGeneratorContractId,
  getRandomResult,
} from "../../../src/services/coin-flip-client";

interface ManualInput {
  serverSeed: string;
  commitment: string;
  requestId: string;
  max: string;
  claimedResult: string;
}

const DEFAULT_INPUT: ManualInput = { ...ROUND_PRESETS[0].input, claimedResult: "" };

/**
 * The four commit-reveal steps the random-generator contract actually runs.
 * Kept in sync with `derive_result` / `fulfill_random` in
 * contracts/random-generator/src/lib.rs — see the copy in about/page.tsx.
 */
const FAIRNESS_FLOW = [
  {
    step: "1",
    title: "The oracle commits",
    caption: "Before any bet exists, the oracle publishes sha256(seed) to the random-generator contract. The seed itself stays hidden.",
  },
  {
    step: "2",
    title: "Your bet locks it in",
    caption: "place_bet pops the oldest commitment from the on-chain queue. From here that hash cannot be swapped for your round.",
  },
  {
    step: "3",
    title: "The seed is revealed",
    caption: "The contract re-hashes the revealed seed and rejects it unless it equals the commitment, then derives the result itself.",
  },
  {
    step: "4",
    title: "You recompute it",
    caption: "Open this page with your round's id: the same formula runs in your browser and the checks below must all pass.",
  },
] as const;

/** Network-scoped explorer link for the deployed random-generator contract. */
function randomGeneratorExplorerUrl(): string | null {
  const contractId = process.env.NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID;
  if (!contractId) return null;
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet";
  return `https://stellar.expert/explorer/${network}/contract/${contractId}`;
}

/** Reads a fulfilled request (and its coin-flip game, if any) from chain. */
async function loadOnChainRound(requestId: bigint) {
  const config = getCoinFlipConfig();
  const server = createCoinFlipRpc(config);
  const entry = await getRandomResult(server, config, getRandomGeneratorContractId(), requestId);
  const game = await getGame(server, config, requestId).catch(() => null);
  return { entry, game };
}

/** Shared field chrome — dark glass input with an accent focus ring. */
const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 font-mono text-[13px] text-foreground " +
  "outline-none transition-colors placeholder:text-muted-foreground/60 " +
  "focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20";

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-foreground">{label}</span>
        {hint ? (
          <span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">{hint}</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function SectionCard({
  id,
  icon,
  title,
  className,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex flex-col rounded-2xl border border-border bg-card/60 backdrop-blur-sm",
        className,
      )}
    >
      <h2
        id={id}
        className="flex items-center gap-2 border-b border-border/70 px-5 py-4 text-sm font-semibold text-foreground [&_svg]:size-4.5 [&_svg]:text-primary"
      >
        {icon}
        {title}
      </h2>
      <div className="flex flex-1 flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

function VerifyPageContent() {
  const searchParams = useSearchParams();
  const requestIdParam = searchParams?.get("requestId") ?? null;
  const [input, setInput] = useState<ManualInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<RoundReport | null>(null);
  const [onChainState, setOnChainState] = useState<
    { status: "loading" } | { status: "ready"; requestId: string } | { status: "error"; message: string } | null
  >(null);
  const [onChainRound, setOnChainRound] = useState<{ result: bigint; game: Awaited<ReturnType<typeof getGame>> | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  // /verify?requestId=<game id>: load the round's revealed seed and stored
  // result from the random-generator contract and verify those, not inputs.
  useEffect(() => {
    if (!requestIdParam) return;
    let requestId: bigint;
    try {
      requestId = BigInt(requestIdParam);
    } catch {
      setOnChainState({ status: "error", message: `"${requestIdParam}" is not a valid request id` });
      return;
    }
    let cancelled = false;
    setOnChainState({ status: "loading" });
    loadOnChainRound(requestId)
      .then(({ entry, game }) => {
        if (cancelled) return;
        setInput({
          serverSeed: entry.serverSeed,
          commitment: entry.commitment,
          requestId: requestId.toString(),
          max: entry.max.toString(),
          claimedResult: "",
        });
        setOnChainRound({ result: entry.result, game });
        setOnChainState({ status: "ready", requestId: requestId.toString() });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setOnChainState({
          status: "error",
          message: /Error\(Contract, #6\)/.test(message)
            ? "This round has not been fulfilled by the oracle yet."
            : message,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [requestIdParam]);

  const runVerification = () => {
    startTransition(() => {
      setResult(
        buildRoundReport(
          input,
          onChainRound && onChainState?.status === "ready" ? onChainRound : undefined,
        ),
      );
    });
  };

  useEffect(() => {
    runVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.serverSeed, input.commitment, input.requestId, input.max, input.claimedResult, onChainRound]);

  const handleApplyPreset = (preset: (typeof ROUND_PRESETS)[number]) => {
    setOnChainRound(null);
    setOnChainState(null);
    setInput({ ...preset.input, claimedResult: "" });
  };

  const handleCopyReport = () => {
    if (!result) return;
    const report = JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        verified: result.isValid,
        source: onChainState?.status === "ready" ? "on-chain" : "manual",
        result: result.result?.toString() ?? null,
        outcome: result.outcomeLabel,
        checks: result.checks,
        input,
      },
      null,
      2,
    );
    navigator.clipboard?.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-6"
    >
      <PageHeader
        icon={<ShieldCheck />}
        eyebrow={
          <Badge variant="outline" className="gap-1.5 border-primary/40 text-primary">
            <Sparkles className="size-3" aria-hidden />
            Runs entirely in your browser
          </Badge>
        }
        title="Provable Fairness Verifier"
        description="Verify any StellarCade round in your browser. Checks the oracle's revealed seed against the commitment it published before the bet, and recomputes the result with the random-generator contract's exact formula — no server trust required."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Quick-load test vectors
          </span>
          {ROUND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleApplyPreset(preset)}
              data-testid={`preset-${preset.id}`}
              className="rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <SectionCard id="verifier-inputs-heading" icon={<Dices />} title="Round Proof Inputs">
          {onChainState ? (
            <p
              data-testid="onchain-status"
              className={cn(
                "rounded-lg border px-3 py-2 text-xs",
                onChainState.status === "error"
                  ? "border-rose-400/30 text-rose-300"
                  : "border-primary/30 text-muted-foreground",
              )}
            >
              {onChainState.status === "loading"
                ? "Loading the round from the random-generator contract…"
                : onChainState.status === "ready"
                  ? `Loaded round ${onChainState.requestId} from chain (get_result).`
                  : `Could not load the round: ${onChainState.message}`}
            </p>
          ) : null}

          <Field id="server-seed-input" label="Revealed Server Seed (32 bytes, hex)" hint="Required">
            <input
              id="server-seed-input"
              className={FIELD_CLASS}
              type="text"
              placeholder="64 hex characters"
              value={input.serverSeed}
              onChange={(e) => setInput({ ...input, serverSeed: e.target.value })}
              data-testid="input-server-seed"
            />
          </Field>

          <Field id="commit-hash-input" label="Seed Commitment (SHA-256, hex)" hint="Published before the bet">
            <input
              id="commit-hash-input"
              className={FIELD_CLASS}
              type="text"
              placeholder="64 hex characters"
              value={input.commitment}
              onChange={(e) => setInput({ ...input, commitment: e.target.value })}
              data-testid="input-commit-hash"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="request-id-input" label="Request ID (game ID)">
              <input
                id="request-id-input"
                className={FIELD_CLASS}
                type="text"
                inputMode="numeric"
                value={input.requestId}
                onChange={(e) => setInput({ ...input, requestId: e.target.value })}
                data-testid="input-request-id"
              />
            </Field>

            <Field id="claimed-result-input" label="Claimed Result" hint="Optional">
              <input
                id="claimed-result-input"
                className={FIELD_CLASS}
                type="text"
                inputMode="numeric"
                value={input.claimedResult}
                onChange={(e) => setInput({ ...input, claimedResult: e.target.value })}
                data-testid="input-claimed-result"
              />
            </Field>
          </div>

          <Field id="game-range-select" label="Outcome Space (max)">
            <select
              id="game-range-select"
              className={cn(FIELD_CLASS, "font-sans")}
              value={input.max}
              onChange={(e) => setInput({ ...input, max: e.target.value })}
              data-testid="select-game-range"
            >
              <option value="2">Coin Flip (2 outcomes: Heads / Tails)</option>
              <option value="6">6 outcomes</option>
              <option value="37">37 outcomes</option>
              <option value="100">100 outcomes</option>
              {["2", "6", "37", "100"].includes(input.max) ? null : (
                <option value={input.max}>{input.max} outcomes</option>
              )}
            </select>
          </Field>

          <Button
            type="button"
            variant="brand"
            onClick={runVerification}
            className="mt-auto self-start"
            data-testid="verify-execute-btn"
          >
            <RotateCcw />
            Recompute Proof
          </Button>
        </SectionCard>

        <SectionCard
          id="verifier-results-heading"
          icon={<Sparkles />}
          title="Cryptographic Audit Results"
        >
          {result ? (
            <>
              <div
                data-testid="verification-status-banner"
                className={cn(
                  "flex items-start gap-3.5 rounded-xl border p-4",
                  result.isValid
                    ? "border-emerald-400/30 bg-emerald-400/5"
                    : "border-rose-400/30 bg-rose-400/5",
                )}
              >
                {result.isValid ? (
                  <CheckCircle2 className="mt-0.5 size-7 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <ShieldAlert className="mt-0.5 size-7 shrink-0 text-rose-400" aria-hidden />
                )}
                <div className="min-w-0">
                  <h3
                    className={cn(
                      "text-sm font-bold tracking-wide",
                      result.isValid ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {result.isValid ? "PROVABLY FAIR VERIFIED" : "VERIFICATION FAILED"}
                  </h3>
                  {result.isValid && (
                    <p className="mt-0.5 text-[11px] font-bold tracking-wide text-primary uppercase">
                      Commitment Verified
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {result.isValid
                      ? "The seed matches its commitment and the result follows from the contract's formula."
                      : "One or more checks failed — see the failed steps below."}
                  </p>
                </div>
              </div>

              <div
                data-testid="verification-outcome-box"
                className="flex flex-col items-center gap-1 rounded-xl border border-primary/25 bg-primary/5 px-4 py-5 text-center"
              >
                <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  Derived Outcome Value
                </span>
                <span
                  data-testid="outcome-value-text"
                  className="font-mono text-2xl font-bold text-primary"
                >
                  {result.outcomeLabel}
                </span>
                <span className="text-xs text-muted-foreground">
                  sha256(server_seed || request_id) first 8 bytes, mod max
                </span>
              </div>

              <ol className="flex flex-col gap-2.5">
                {result.checks.map((step, idx) => (
                  <li
                    key={idx}
                    data-testid={`step-item-${idx}`}
                    className="rounded-xl border border-border bg-background/40 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">{step.step}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider",
                          step.passed
                            ? "bg-emerald-400/10 text-emerald-400"
                            : "bg-rose-400/10 text-rose-400",
                        )}
                      >
                        {step.passed ? "PASSED" : "FAILED"}
                      </span>
                    </div>
                    <p className="mt-2 truncate font-mono text-[11px] text-primary/80">
                      Actual: {step.actual}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{step.details}</p>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                <span className="text-[13px] text-muted-foreground">Export Proof Audit Summary</span>
                <Button size="sm" variant="outline" onClick={handleCopyReport} data-testid="btn-copy-report">
                  {copied ? (
                    <>
                      <Check className="text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy />
                      Copy Audit JSON
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Evaluating proof…</p>
          )}
        </SectionCard>
      </div>

      <SectionCard id="how-it-works" icon={<ShieldCheck />} title="How this works">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Coin-flip outcomes are decided by the <span className="font-mono text-foreground">random-generator</span>{" "}
          contract&apos;s commit-reveal scheme, not by StellarCade&apos;s servers. Nothing below needs to be
          trusted: each step is an on-chain call anyone can read, and this page recomputes the maths in your own
          browser.
        </p>

        {/* Four-step commit-reveal diagram: vertical on small screens, a row of
            linked boxes on wide ones. */}
        <div
          data-testid="fairness-flow"
          className="flex flex-col items-stretch gap-2 xl:flex-row xl:items-center"
        >
          {FAIRNESS_FLOW.map((item, index) => (
            <React.Fragment key={item.step}>
              <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
                  {item.step}
                </span>
                <h3 className="mt-1 text-sm font-bold text-foreground">{item.title}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{item.caption}</p>
              </div>
              {index < FAIRNESS_FLOW.length - 1 ? (
                <ArrowRight
                  aria-hidden
                  className="mx-auto size-4 shrink-0 rotate-90 text-primary xl:mx-0 xl:rotate-0"
                />
              ) : null}
            </React.Fragment>
          ))}
        </div>

        <div data-testid="fairness-formula" className="rounded-xl border border-border bg-background/40 p-4">
          <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            The contract&apos;s formula
          </span>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono text-xs text-primary">
            result = first 8 bytes of sha256(server_seed ‖ round_id) as big-endian, % 2
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            round_id is the game id, 8 bytes big-endian. 0 is Heads, 1 is Tails. The oracle only supplies the
            seed — the contract derives the result when it accepts the reveal, and coin-flip&apos;s{" "}
            <span className="font-mono">resolve_bet</span> just reads it.
          </p>
        </div>

        <div>
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-foreground uppercase">
            What the contracts enforce
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <li>
              No commitment, no bet: <span className="font-mono">place_bet</span> calls{" "}
              <span className="font-mono">request_random</span>, which fails with{" "}
              <span className="font-mono">NoCommitmentAvailable</span> while the oracle&apos;s queue is empty.
            </li>
            <li>
              The commitment is popped and bound to your game id in the same transaction that places the bet, so
              the hash deciding your round is fixed on-chain before anyone can react to it.
            </li>
            <li>
              The reveal is checked, not trusted: <span className="font-mono">fulfill_random</span> recomputes{" "}
              <span className="font-mono">sha256(seed)</span> and rejects anything that does not equal the
              commitment (<span className="font-mono">SeedCommitmentMismatch</span>), then stores the derived
              result for <span className="font-mono">/verify</span> to re-check.
            </li>
          </ul>
        </div>

        <div data-testid="fairness-limits">
          <h3 className="text-[11px] font-semibold tracking-[0.14em] text-foreground uppercase">
            What it does not protect against
          </h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
            <li>
              <span className="text-foreground">A reveal can be refused.</span> Commit-reveal stops the seed
              changing after your bet; it cannot force the oracle to publish it. If the oracle never fulfils the
              request, the round stays pending with no result — and the coin-flip contract covers you: after{" "}
              <span className="font-mono">RefundTimeoutLedgers</span> (17,280 ledgers, about 24 hours) you can
              call <span className="font-mono">cancel_stale_bet</span> to reclaim your full wager. If the seed
              lands first, that refund is refused and the round settles instead; a refunded game can never be
              resolved, so you get a refund or a payout, never both.
            </li>
            <li>
              <span className="text-foreground">The oracle knows the seeds it commits.</span> Commitment fixes
              them before your bet — it does not hide them from the oracle, only SHA-256 preimage resistance
              hides them from everyone else.
            </li>
          </ul>
        </div>

        {randomGeneratorExplorerUrl() ? (
          <div className="border-t border-border/70 pt-4">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Deployed random-generator contract
            </span>
            <p
              className="mt-1 break-all font-mono text-xs text-muted-foreground"
              data-testid="rng-contract-address"
            >
              {process.env.NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID}
            </p>
            <a
              href={randomGeneratorExplorerUrl()!}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-primary transition-opacity hover:opacity-80"
              data-testid="rng-contract-explorer-link"
            >
              View it on stellar.expert
            </a>
          </div>
        ) : null}
      </SectionCard>
    </motion.div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted-foreground">Loading verifier…</p>}>
      <VerifyPageContent />
    </Suspense>
  );
}
