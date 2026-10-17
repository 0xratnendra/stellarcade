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
