"use client";

import { useEffect, useState } from "react";
import { useWalletStatus } from "../hooks/useWalletStatus";
import { ApiClient, type QuestProgressDto } from "./typed-api-sdk";

/**
 * Player-facing data sources and hooks.
 *
 * Provides reactive hooks for on-chain game match history, global leaderboard
 * standings, quests, and rewards. Settled rounds are indexed directly from
 * Soroban contract events and exposed via the REST API.
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
 * Loads the connected wallet's settled rounds from GET /api/games/recent?player=.
 */
export function useSettledRounds(
  playerOverride?: string | null,
): Collection<SettledRound> & { error?: string } {
  const wallet = useWalletStatus();
  const player = playerOverride !== undefined ? playerOverride : wallet.address;

  const [items, setItems] = useState<SettledRound[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(player));
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;

    if (!player) {
      setItems([]);
      setIsLoading(false);
      setError(undefined);
      return;
    }

    setIsLoading(true);
    setError(undefined);

    const client = new ApiClient();
    client
      .getRecentGames({ player, limit: 50 })
      .then((result) => {
        if (!active) return;
        if (result.success) {
          const mapped: SettledRound[] = (result.data.items || []).map((dto) => {
            const rawType = String(dto.game_type || "coin-flip").toLowerCase();
            let gameType: SettledRound["gameType"] = "coinflip";
            let gameName = "Coin Flip";
            if (rawType.includes("dice")) {
              gameType = "dice";
              gameName = "Verifiable Dice Roll";
            } else if (rawType.includes("gauntlet") || rawType.includes("prize")) {
              gameType = "gauntlet";
              gameName = "Prize Pool Gauntlet";
            }

            const isWin =
              String(dto.result || "").toLowerCase() === "win" ||
              (Number(dto.payout || 0) > 0 && String(dto.status || "") === "resolved");

            return {
              id: String(dto.chain_game_id || dto.id || ""),
              game: gameName,
              gameType,
              wagerXlm: Number(dto.bet_amount || 0),
              payoutXlm: Number(dto.payout || 0),
              outcome: isWin ? "WIN" : "LOSS",
              settledAt: dto.resolved_at
                ? new Date(dto.resolved_at).getTime()
                : dto.created_at
                  ? new Date(dto.created_at).getTime()
                  : Date.now(),
              serverSeed: String(dto.server_seed || ""),
              commitHash: String(dto.commit_hash || ""),
              clientSeed: String(dto.client_seed || ""),
              nonce: Number(dto.nonce || 0),
              rangeSize: Number(dto.range_size || 2),
            };
          });
          setItems(mapped);
          setError(undefined);
        } else {
          setError(result.error.message || "Failed to load settled rounds.");
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load settled rounds.");
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
 * Player standings by net winnings.
 * Loads rankings from GET /api/leaderboard.
 */
export function useLeaderboard(
  opts?: { game?: string; limit?: number },
): Collection<LeaderboardEntry> & { error?: string } {
  const [items, setItems] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const game = opts?.game;
  const limit = opts?.limit ?? 50;

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(undefined);

    const client = new ApiClient();
    client
      .getLeaderboard({ game, limit })
      .then((result) => {
        if (!active) return;
        if (result.success) {
          const mapped: LeaderboardEntry[] = (result.data || []).map((row, idx) => {
            const rawScore = String(row.score ?? "0");
            const numericScore = Number(rawScore) || 0;
            const addr = row.playerAddress || "";
            const short = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Anonymous";
            return {
              rank: row.rank || idx + 1,
              address: addr,
              username: short,
              wins: numericScore > 0 ? 1 : 0,
              totalVolumeXlm: numericScore,
              winRate: "100%",
            };
          });
          setItems(mapped);
          setError(undefined);
        } else {
          setError(result.error.message || "Failed to load leaderboard.");
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load leaderboard.");
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [game, limit]);

  return { items, isLoading, error };
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
