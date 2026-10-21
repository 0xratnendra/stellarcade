"use client";

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Trash2,
  ShieldCheck,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "../../../src/components/ui/button";
import { PageHeader } from "../../../src/components/ui/page-header";
import { StatTile } from "../../../src/components/ui/stat-tile";
import { cn } from "../../../src/lib/utils";
import { useWalletStatus } from "../../../src/hooks/useWalletStatus";
import {
  scanAccountHygiene,
  type HygieneScanResult,
} from "../../../src/utils/account-hygiene";
import {
  buildCleanupTransaction,
  calculateReclaimedXlm,
  getCleanupConfig,
} from "../../../src/services/account-cleanup";
import defaultFreighterAdapter from "../../../src/services/freighter-adapter";

const DEMO_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCADEPLAYERHYGIENE777SAMPLEPUBLICKEY";

export default function CleanupPage() {
  const { address } = useWalletStatus();
  const [targetAddress, setTargetAddress] = useState<string>(address || DEMO_PUBLIC_KEY);
  const [scanResult, setScanResult] = useState<HygieneScanResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCleaning, setIsCleaning] = useState(false);
  const [reclaimSuccess, setReclaimSuccess] = useState<{
    reclaimedXlm: number;
    count: number;
    txHash?: string;
  } | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  const handleScan = (addressToScan: string) => {
    const res = scanAccountHygiene(addressToScan);
    setScanResult(res);
    // Select all cleanable by default
    setSelectedIds(res.reclaimableSubentries.map((s) => s.id));
    setReclaimSuccess(null);
  };

  useEffect(() => {
    if (address) {
      setTargetAddress(address);
      handleScan(address);
    } else {
      handleScan(targetAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleExecuteCleanup = async () => {
    if (!scanResult || selectedIds.length === 0) return;
    setIsCleaning(true);
    setCleanupError(null);

    let config: ReturnType<typeof getCleanupConfig>;
    try {
      config = getCleanupConfig();
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : String(err));
      setIsCleaning(false);
      return;
    }

    const toRemove = scanResult.reclaimableSubentries.filter((s) => selectedIds.includes(s.id));
    try {
      const { Horizon } = await import("@stellar/stellar-sdk");
      const horizon = new Horizon.Server(config.horizonUrl);

      const beforeAccount = await horizon.loadAccount(scanResult.accountPublicKey);
      const tx = await buildCleanupTransaction(
        scanResult.accountPublicKey,
        toRemove,
        config.networkPassphrase,
        { horizon },
      );
      const signedXdr = await defaultFreighterAdapter.signTransaction(tx.toXDR(), {
        networkPassphrase: config.networkPassphrase,
      });
      const { TransactionBuilder } = await import("@stellar/stellar-sdk");
      const signed = TransactionBuilder.fromXDR(signedXdr, config.networkPassphrase);
      const result = await horizon.submitTransaction(signed);
      const afterAccount = await horizon.loadAccount(scanResult.accountPublicKey);
      const reclaimedXlm = calculateReclaimedXlm(beforeAccount, afterAccount);

      const remainingSubentries = scanResult.reclaimableSubentries.filter(
        (s) => !selectedIds.includes(s.id),
      );
      setScanResult({
        ...scanResult,
        totalSubentries: scanResult.totalSubentries - toRemove.length,
        totalLockedReserveXlm: scanResult.totalLockedReserveXlm - toRemove.reduce((a, b) => a + b.lockedReserveXlm, 0),
        reclaimableSubentries: remainingSubentries,
        reclaimableReserveXlm: remainingSubentries.reduce((a, b) => a + b.lockedReserveXlm, 0),
      });
      setReclaimSuccess({ reclaimedXlm, count: toRemove.length, txHash: result.hash });
      setSelectedIds([]);
    } catch (err) {
      setCleanupError(
        err instanceof Error ? err.message : "Cleanup transaction failed. Please try again.",
      );
    } finally {
      setIsCleaning(false);
    }
  };

  const selectedReclaimValue = scanResult
    ? scanResult.reclaimableSubentries
        .filter((s) => selectedIds.includes(s.id))
        .reduce((a, b) => a + b.lockedReserveXlm, 0)
    : 0;
  const allSelected =
    !!scanResult && selectedIds.length === scanResult.reclaimableSubentries.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-6"
    >
      <PageHeader
        icon={<Sparkles />}
        title="Cleanup & Reserve Recovery"
        description="Reclaim XLM base reserves locked by zero-balance trustlines, expired event badges, and stale session authorizations on the Stellar network (0.5 XLM per subentry)."
      >
        <div
          className="flex flex-col gap-2 sm:flex-row"
          role="search"
          aria-label="Stellar account scanner"
        >
          <label htmlFor="input-hygiene-address" className="sr-only">
            Stellar public key
          </label>
          <input
            id="input-hygiene-address"
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-2.5 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/20"
            type="text"
            placeholder="Enter Stellar Public Key (G…)"
            value={targetAddress}
            onChange={(e) => setTargetAddress(e.target.value)}
            data-testid="input-hygiene-address"
          />
          <Button
            type="button"
            variant="brand"
            className="shrink-0"
            onClick={() => handleScan(targetAddress)}
            data-testid="btn-scan-account"
          >
            <RotateCcw />
            Scan Account
          </Button>
        </div>
      </PageHeader>

      {cleanupError && (
        <div
          role="alert"
          data-testid="cleanup-error-banner"
          className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-300"
        >
          {cleanupError}
        </div>
      )}

      {reclaimSuccess && (
        <div
          data-testid="reclaim-success-banner"
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4"
        >
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-400" aria-hidden />
          <div>
            <strong className="text-sm font-bold text-emerald-400">Reclamation Complete!</strong>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Successfully removed {reclaimSuccess.count} subentry item(s) and released +
              {reclaimSuccess.reclaimedXlm.toFixed(1)} XLM back to your spendable balance.
            </p>
            {reclaimSuccess.txHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${reclaimSuccess.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block font-mono text-xs text-sky-300 underline"
                data-testid="cleanup-tx-link"
              >
                {reclaimSuccess.txHash}
              </a>
            )}
          </div>
        </div>
      )}

      {scanResult && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Total Subentries"
            value={String(scanResult.totalSubentries)}
            caption={`${scanResult.totalLockedReserveXlm.toFixed(1)} XLM locked in base account reserve`}
            data-testid="stat-total-subentries"
          />
          <StatTile
            label="Reclaimable Reserve"
            value={`+${scanResult.reclaimableReserveXlm.toFixed(1)} XLM`}
            trend="up"
            caption={`${scanResult.reclaimableSubentries.length} inactive or empty entries found`}
            data-testid="stat-reclaimable-xlm"
          />
          <StatTile
            label="Selected for Cleanup"
            value={`+${selectedReclaimValue.toFixed(1)} XLM`}
            caption={`${selectedIds.length} item(s) selected`}
            data-testid="stat-selected-xlm"
          />
        </div>
      )}

      {scanResult && (
        <section
          aria-labelledby="subentries-heading"
          className="flex flex-col rounded-2xl border border-border bg-card/60 backdrop-blur-sm"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
            <h2 id="subentries-heading" className="text-sm font-semibold text-foreground">
              Subentry Inventory ({scanResult.reclaimableSubentries.length} reclaimable)
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedIds(allSelected ? [] : scanResult.reclaimableSubentries.map((s) => s.id))
              }
              data-testid="btn-toggle-select-all"
            >
              {allSelected ? "Deselect All" : "Select All Reclaimable"}
            </Button>
          </header>

          {scanResult.reclaimableSubentries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
              <ShieldCheck className="size-9 text-emerald-400" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Account hygiene is in perfect shape! No stale or empty subentries found.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {scanResult.reclaimableSubentries.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <li
                    key={item.id}
                    data-testid={`subentry-row-${item.id}`}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3.5 transition-colors",
                      isSelected ? "bg-primary/5" : "hover:bg-background/40",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 cursor-pointer accent-[color:var(--sc-accent)]"
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select ${item.description}`}
                      data-testid={`checkbox-${item.id}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{item.description}</p>
                      {item.assetCode && (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          Asset: {item.assetCode} · Issuer: {item.assetIssuer}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-400">
                      +{item.lockedReserveXlm.toFixed(1)} XLM
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {scanResult.reclaimableSubentries.length > 0 && (
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-5 py-4">
              <p className="text-sm">
                <span className="font-semibold text-foreground">Total Recovery Potential: </span>
                <span className="font-mono font-bold text-emerald-400">
                  +{selectedReclaimValue.toFixed(1)} XLM
                </span>
              </p>

              <Button
                type="button"
                variant="brand"
                disabled={selectedIds.length === 0 || isCleaning}
                onClick={handleExecuteCleanup}
                data-testid="btn-execute-cleanup"
              >
                <Trash2 />
                {isCleaning ? "Reclaiming Reserves…" : `Reclaim (${selectedIds.length}) Entries`}
              </Button>
            </footer>
          )}
        </section>
      )}
    </motion.div>
  );
}
