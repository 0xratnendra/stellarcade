"use client";

import React, { useCallback, useId, useState } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { useWalletStatus } from "../hooks/useWalletStatus";
import defaultFreighterAdapter from "../services/freighter-adapter";
import { CoinFlipSide } from "../types/contracts/coinFlip";
import {
  CoinFlipBetError,
  getCoinFlipConfig,
  placeBet,
  stroopsToXlm,
} from "../services/coin-flip-client";
import { useCoinFlipGame } from "../hooks/useCoinFlipGame";
import { isSupportedNetwork } from "../utils/useNetworkGuard";

const WAGER_PRESETS = [5, 10, 25, 50];

/** Shared styling for the pick/wager choice buttons. */
function choiceClass(selected: boolean) {
  return cn(
    "rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
    selected
      ? "border-primary bg-primary/15 text-primary"
      : "border-border bg-background/40 text-foreground hover:border-primary/40",
  );
}

interface CoinFlipPlayPanelProps {
  /** Suffix appended to every data-testid (e.g. "arena" → btn-confirm-bet-arena). */
  testIdSuffix?: string;
  /** Called when a bet is placed successfully. */
  onBetPlaced?: (placed: { gameId: bigint; txHash: string }) => void;
}

/**
 * Shared coin-flip play flow: pick a side, choose a wager, place a real
 * on-chain bet via the Freighter wallet, and watch the result settle.
 *
 * Used by both the lobby drawer (GameLobby.tsx) and the games arena page
 * (app/(dashboard)/games/page.tsx) so there is exactly one play implementation.
 */
export const CoinFlipPlayPanel: React.FC<CoinFlipPlayPanelProps> = ({
  testIdSuffix = "",
  onBetPlaced,
}) => {
  const wallet = useWalletStatus();
  const [playWager, setPlayWager] = useState<number>(5);
  const [playSide, setPlaySide] = useState<CoinFlipSide>(CoinFlipSide.Heads);
  const [isExecutingPlay, setIsExecutingPlay] = useState<boolean>(false);
  const [placedBet, setPlacedBet] = useState<{ gameId: bigint; txHash: string } | null>(null);
  const [betError, setBetError] = useState<string | null>(null);
  const liveGame = useCoinFlipGame(placedBet?.gameId ?? null);

  const errorId = useId();
  const statusId = useId();

  const handleExecutePlay = useCallback(async () => {
    if (!wallet.capabilities.isConnected) {
      await wallet.connect(defaultFreighterAdapter);
      return;
    }

    let networkPassphrase: string;
    try {
      networkPassphrase = getCoinFlipConfig().networkPassphrase;
    } catch (configError) {
      setBetError(configError instanceof Error ? configError.message : String(configError));
      return;
    }
    const networkCheck = isSupportedNetwork(wallet.network, {
      supportedNetworks: [networkPassphrase],
    });
    if (!networkCheck.isSupported || !wallet.address) {
      setBetError(
        `Switch Freighter to ${networkCheck.supportedNetworks.join(" / ")} to place a bet.`,
      );
      return;
    }

    setBetError(null);
    setIsExecutingPlay(true);
    try {
      const placed = await placeBet({
        player: wallet.address,
        side: playSide === CoinFlipSide.Heads ? 0 : 1,
        wagerXlm: String(playWager),
      });
      setPlacedBet(placed);
      onBetPlaced?.(placed);
    } catch (placeError) {
      setBetError(
        placeError instanceof CoinFlipBetError
          ? placeError.message
          : "Could not place the bet. Please try again.",
      );
    } finally {
      setIsExecutingPlay(false);
    }
  }, [onBetPlaced, playSide, playWager, wallet]);

  const handlePlayAgain = useCallback(() => {
    setPlacedBet(null);
    setBetError(null);
  }, []);

  if (placedBet) {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
          data-testid={`coinflip-live-result${testIdSuffix}`}
          aria-live="polite"
          aria-atomic="true"
        >
          {liveGame.status === "resolved" && liveGame.game ? (
            liveGame.game.refunded ? (
              <p className="font-bold" data-testid={`coinflip-outcome${testIdSuffix}`}>
                Bet refunded: {stroopsToXlm(liveGame.game.wager)} XLM returned
              </p>
            ) : (
              <>
                <p className="font-bold" data-testid={`coinflip-outcome${testIdSuffix}`}>
                  {/* The coin landed on the player's side iff they won. */}
                  Landed on{" "}
                  {(liveGame.game.won ? liveGame.game.side : 1 - liveGame.game.side) === 0
                    ? "Heads"
                    : "Tails"}{" "}
                  · {liveGame.game.won ? "You won" : "You lost"}
                </p>
                <p className="mt-1">
                  Payout: {stroopsToXlm(liveGame.game.payout)} XLM (wager{" "}
                  {stroopsToXlm(liveGame.game.wager)} XLM)
                </p>
              </>
            )
          ) : liveGame.status === "timeout" ? (
            <p className="font-bold" data-testid={`coinflip-outcome${testIdSuffix}`}>
              Still waiting for the oracle to fulfil this round…
            </p>
          ) : liveGame.status === "error" ? (
            <p className="font-bold text-rose-300" data-testid={`coinflip-outcome${testIdSuffix}`}>
              Couldn&apos;t read the game state: {liveGame.error}
            </p>
          ) : (
            <p className="font-bold" data-testid={`coinflip-outcome${testIdSuffix}`}>
              Bet placed · waiting for the result…
            </p>
          )}
          <p className="mt-2 break-all font-mono text-xs text-slate-400">
            Game ID: {placedBet.gameId.toString()}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            <li>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${placedBet.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-300 underline"
              >
                Bet transaction
              </a>
            </li>
            {liveGame.resolveTxHash ? (
              <li>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${liveGame.resolveTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-300 underline"
                >
                  Resolution transaction
                </a>
              </li>
            ) : null}
            {liveGame.status === "resolved" && !liveGame.game?.refunded ? (
              <li>
                <a
                  href={`/verify?requestId=${placedBet.gameId.toString()}`}
                  className="text-sky-300 underline"
                  data-testid={`coinflip-verify-link${testIdSuffix}`}
                >
                  Verify this round
                </a>
              </li>
            ) : null}
            <li>
              <a
                href="/verify#how-it-works"
                className="text-sky-300 underline"
                data-testid={`coinflip-fairness-link${testIdSuffix}`}
              >
                How is this fair?
              </a>
            </li>
          </ul>
        </div>
        <Button
          type="button"
          variant="brand"
          className="w-full"
          onClick={handlePlayAgain}
          data-testid={`btn-play-again${testIdSuffix}`}
        >
          Play Another Round
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Polite live region for submission status (screen readers). */}
      <div
        id={statusId}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid={`coinflip-status${testIdSuffix}`}
      >
        {isExecutingPlay ? "Placing bet on Soroban, please wait…" : ""}
      </div>

      {/* Side selection — real radio group for arrow-key navigation. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-foreground">Choose your pick</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Coin side">
          {(
            [
              { side: CoinFlipSide.Heads, label: "🪙 Heads", testId: `btn-pick-heads${testIdSuffix}` },
              { side: CoinFlipSide.Tails, label: "🪙 Tails", testId: `btn-pick-tails${testIdSuffix}` },
            ] as const
          ).map(({ side, label, testId }) => (
            <label
              key={side}
              className={cn(choiceClass(playSide === side), "flex cursor-pointer items-center justify-center")}
              data-testid={testId}
            >
              <input
                type="radio"
                name={`coinflip-side${testIdSuffix}`}
                value={side}
                checked={playSide === side}
                onChange={() => setPlaySide(side)}
                className="sr-only"
                aria-label={label.replace("🪙 ", "")}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold text-foreground">
          Wager amount (XLM)
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {WAGER_PRESETS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setPlayWager(w)}
              aria-pressed={playWager === w}
              className={cn(choiceClass(playWager === w), "font-mono")}
            >
              {w}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-2">
        {betError ? (
          <p
            id={errorId}
            role="alert"
            className="mb-2 text-sm text-rose-300"
            data-testid={`bet-error${testIdSuffix}`}
          >
            {betError}
          </p>
        ) : null}
        <Button
          type="button"
          variant="brand"
          size="lg"
          className="w-full"
          onClick={handleExecutePlay}
          disabled={isExecutingPlay}
          aria-busy={isExecutingPlay}
          aria-describedby={betError ? errorId : undefined}
          aria-controls={statusId}
          data-testid={`btn-confirm-bet${testIdSuffix}`}
        >
          {isExecutingPlay
            ? "🎲 Placing bet on Soroban..."
            : !wallet.capabilities.isConnected
              ? "Connect Wallet & Play"
              : `Place ${playWager} XLM Bet`}
        </Button>
      </div>
    </div>
  );
};

export default CoinFlipPlayPanel;
