"use client";

import { useEffect, useState } from "react";
import { useWalletStatus } from "../hooks/useWalletStatus";
import { ApiClient, type QuestProgressDto } from "./typed-api-sdk";

/**
 * Player-facing data sources that do not exist yet.
 *
 * StellarCade is pre-launch: the game contracts are stubs, the arbiter's
 * settlement log is not exposed over the API, and no rounds have settled. So
 * none of the surfaces below — match history, leaderboard, tournaments,
 * quests, claimable rewards — have anything real to show.
 *
 * Rather than scatter sample arrays through the route files (where they read
 * as real standings and balances), every one of them is declared here,
 * returns empty, and records exactly what has to exist before it can return
 * anything. Wire the real request into the matching hook and the route that
 * consumes it starts rendering — the components already handle the populated
 * case.
 *
 * The types are the contract those endpoints will have to satisfy, so they
 * are deliberately concrete rather than `unknown`.
 */

export interface SettledRound {
  id: string;
  game: string;
  gameType: "coinflip" | "dice" | "gauntlet";
  wagerXlm: number;
  payoutXlm: number;
  outcome: "WIN" | "LOSS";
  settledAt: number;
  /** Commit-reveal proof material, for deep-linking into /verify. */
  serverSeed: string;
  commitHash: string;
  clientSeed: string;
  nonce: number;
  rangeSize: number;
}

export interface LeaderboardEntry {
  rank: number;
  address: string;
  username: string;
  wins: number;
  totalVolumeXlm: number;
  winRate: string;
}

export interface Tournament {
  id: string;
  title: string;
  category: string;
  entryFeeXlm: number;
  prizePoolXlm: number;
  participants: number;
  maxParticipants: number;
  status: "live" | "registration" | "upcoming";
  startsIn: string;
}

export interface Quest {
  id: string;
  title: string;
  category: "Daily" | "Weekly" | "Special";
  xpReward: number;
  progress: number;
  total: number;
  completed: boolean;
  claimed: boolean;
  desc: string;
}

export interface RewardItem {
  id: string;
  title: string;
  source: string;
  amountXlm: number;
  status: "claimable" | "claimed" | "locked";
  expiry: string;
}

export interface Collection<T> {
  items: T[];
  isLoading: boolean;
}

function empty<T>(): Collection<T> {
  return { items: [], isLoading: false };
}

export interface QuestMetadata {
  title: string;
  category: "Daily" | "Weekly" | "Special";
  xpReward: number;
  total: number;
  desc: string;
}

export const KNOWN_QUESTS: Record<string, QuestMetadata> = {
  "daily-login": {
    title: "Log in today",
    category: "Daily",
    xpReward: 50,
    total: 1,
    desc: "Sign in and visit the arcade to maintain your daily streak.",
  },
  "play-5-games": {
    title: "Play 5 games",
    category: "Weekly",
    xpReward: 150,
    total: 5,
    desc: "Complete 5 provably fair games across coin-flip or dice arenas.",
  },
  "win-3-games": {
    title: "Win 3 games",
    category: "Weekly",
    xpReward: 250,
    total: 3,
    desc: "Achieve victory in 3 rounds on StellarCade.",
  },
};

/**
 * Maps raw backend QuestProgressDto objects to frontend Quest records.
 * When dtos is null/undefined or empty (e.g. no wallet connected), default
 * catalog definitions are returned with zero progress.
 * Rewards are never marked as claimable here because reward minting is coming soon.
 */
export function mapQuests(dtos?: QuestProgressDto[] | null): Quest[] {
  if (!dtos || dtos.length === 0) {
    return Object.entries(KNOWN_QUESTS).map(([id, meta]) => ({
      id,
      title: meta.title,
      category: meta.category,
      xpReward: meta.xpReward,
      progress: 0,
      total: meta.total,
      completed: false,
      claimed: false,
      desc: meta.desc,
    }));
  }

  return dtos.map((dto) => {
    const meta = KNOWN_QUESTS[dto.questId] ?? {
      title: dto.questId
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      category: "Special",
      xpReward: 100,
      total: dto.target || 1,
      desc: `Complete the ${dto.questId} quest.`,
    };

    const target = dto.target > 0 ? dto.target : meta.total;
    const progress = Math.max(0, dto.progress);
    const completed = progress >= target;

    return {
      id: dto.questId,
      title: meta.title,
      category: meta.category,
      xpReward: meta.xpReward,
      progress,
      total: target,
      completed,
      claimed: Boolean(dto.claimed),
      desc: meta.desc,
    };
  });
}

/**
 * Rounds this wallet has settled.
 * Blocked on: the arbiter exposing its settlement log over the API.
 */
export function useSettledRounds(): Collection<SettledRound> {
  return empty();
}

/**
 * Player standings by net winnings.
 * Blocked on: settled rounds existing at all — the board is derived from them.
 */
export function useLeaderboard(): Collection<LeaderboardEntry> {
  return empty();
}

/**
 * Scheduled brackets and their escrowed prize pools.
 * Blocked on: the prize-pool contract (currently a stub) and a scheduler.
 */
export function useTournaments(): Collection<Tournament> {
  return empty();
}

/**
 * Quest milestones and per-player progress.
 * Fetches real progress from GET /api/quests?player= when a player address is available.
 * Shows default quest catalog with 0 progress when disconnected.
 */
export function useQuests(
  playerOverride?: string | null,
): Collection<Quest> & { error?: string } {
  const wallet = useWalletStatus();
  const player = playerOverride !== undefined ? playerOverride : wallet.address;

  const [items, setItems] = useState<Quest[]>(() => mapQuests(null));
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(player));
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;

    if (!player) {
      setItems(mapQuests(null));
      setIsLoading(false);
      setError(undefined);
      return;
    }

    setIsLoading(true);
    setError(undefined);

    const client = new ApiClient();
    client
      .getQuests(player)
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setItems(mapQuests(result.data));
          setError(undefined);
        } else {
          setError(result.error.message || "Failed to load quests.");
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load quests.");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [player]);

  return { items, isLoading, error };
}

/**
 * Payouts this wallet can claim.
 * Blocked on: the prize-pool contract holding real balances. This one matters
 * most — a sample "125 XLM claimable" reads as money the player owns.
 */
export function useClaimableRewards(): Collection<RewardItem> {
  return empty();
}
