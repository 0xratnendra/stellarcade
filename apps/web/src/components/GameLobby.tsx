"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import StatusCard from "./StatusCard";
import NetworkGuardBanner from "./NetworkGuardBanner";
import WalletStatusCard from "./WalletStatusCard";
import PrizePoolStateCard from "./PrizePoolStateCard";
import { DataTable, type DataTableColumn } from "./DataTable";
import { SkeletonPreset } from "./LoadingSkeletonSet";
import TransactionDetailDrawer from "./TransactionDetailDrawer";
import SectionHeader from "./SectionHeader";
import { commandStore } from "./CommandPalette";
import { DashboardMissionStrip } from "./DashboardMissionStrip";
import { QuickActionSurface } from "./QuickActionSurface";
import { RecoverableErrorPanel } from "./RecoverableErrorPanel";
import { PendingActionResumeChip } from "./PendingActionResumeChip";
import { ResumeTaskBanner } from "./ResumeTaskBanner";
import { SegmentedControl } from "./SegmentedControl";
import { WalletSessionActivityRail } from "./WalletSessionActivityRail";
import { ActionToolbar, type ToolbarAction } from "./ActionToolbar";
import { InlineStatDelta } from "./InlineStatDelta";
import { QueueHealthWidget } from "./QueueHealthWidget";
import { QueueStateMiniPanel } from "./QueueStateMiniPanel";
import { CollapsibleStatsGroup } from "./CollapsibleStatsGroup";
import { RewardBalanceSparklineCard } from "./RewardBalanceSparklineCard";
import { Button } from "./ui/button";
import { Command, RefreshCw } from "lucide-react";
import { useWalletStatus } from "../hooks/useWalletStatus";
import { ApiClient, ONCHAIN_GAMES_CATALOG } from "../services/typed-api-sdk";
import defaultFreighterAdapter from "../services/freighter-adapter";
import Drawer from "./Drawer";
import CoinFlipPlayPanel from "./CoinFlipPlayPanel";
import GlobalStateStore, {
  getTableDensityPreference,
  ONBOARDING_CHECKLIST_DISMISSED_FLAG,
  persistTableDensityPreference,
  type TableDensityPreference,
} from "../services/global-state-store";
import { isSupportedNetwork } from "../utils/useNetworkGuard";
import type { Game } from "../types/api-client";
import type { PendingTransactionSnapshot } from "../types/global-state";
import "./GameLobbyDashboard.css";

const DASHBOARD_DENSITY_SCOPE = "dashboard-surfaces";
const DASHBOARD_COMMAND_SURFACE_USED_KEY = "stc_dashboard_command_surface_used_v1";
const DASHBOARD_SESSION_KEY = "stc_dashboard_session_seen_v1";
const DASHBOARD_LAST_CONTEXT_KEY = "stc_dashboard_last_context_v1";

type LobbyContext =
  | "wallet-panel"
  | "live-arena"
  | "leaderboard"
  | "activity-rail";

const LOBBY_CONTEXT_LABELS: Record<LobbyContext, string> = {
  "wallet-panel": "Wallet and network status",
  "live-arena": "Live Arena",
  leaderboard: "Active Games Leaderboard",
  "activity-rail": "Wallet activity rail",
};

interface LeaderboardRow {
  rank: number;
  id: string;
  name: string;
  status: string;
  wager: number;
}

function formatCompactAddress(address: string | null): string {
  if (!address) {
    return "No wallet connected";
  }
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatPendingTxLabel(
  pendingTransaction: PendingTransactionSnapshot | null,
): string {
  if (!pendingTransaction) {
    return "No pending tx";
  }
  return pendingTransaction.phase.replace(/_/g, " ");
}

function formatPendingTaskName(
  pendingTransaction: PendingTransactionSnapshot | null,
): string {
  if (!pendingTransaction) {
    return "Pending wallet task";
  }

  return pendingTransaction.operation.replace(/[._]/g, " ");
}

function readStoredLobbyContext(): LobbyContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = sessionStorage.getItem(DASHBOARD_LAST_CONTEXT_KEY);
    if (
      stored === "wallet-panel" ||
      stored === "live-arena" ||
      stored === "leaderboard" ||
      stored === "activity-rail"
    ) {
      return stored;
    }
  } catch {
    // no-op
  }

  return null;
}

export const GameLobby: React.FC = () => {
  const [games, setGames] = useState<Game[]>(ONCHAIN_GAMES_CATALOG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [lastGamesSyncAt, setLastGamesSyncAt] = useState<number | null>(null);
  const [networkCheckPending, setNetworkCheckPending] = useState(false);
  const [pendingTransaction, setPendingTransaction] =
    useState<PendingTransactionSnapshot | null>(null);
  const [isTransactionDrawerOpen, setIsTransactionDrawerOpen] = useState(false);
  const [quickActionsUsed, setQuickActionsUsed] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return sessionStorage.getItem(DASHBOARD_COMMAND_SURFACE_USED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [isNewDashboardSession] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      const isNewSession = sessionStorage.getItem(DASHBOARD_SESSION_KEY) !== "true";
      sessionStorage.setItem(DASHBOARD_SESSION_KEY, "true");
      return isNewSession;
    } catch {
      return false;
    }
  });
  const [tableDensity, setTableDensity] = useState<TableDensityPreference>(() =>
    getTableDensityPreference(DASHBOARD_DENSITY_SCOPE),
  );
  const [pendingResumeContext, setPendingResumeContext] =
    useState<LobbyContext | null>(null);
  const [showPendingTaskBanner, setShowPendingTaskBanner] = useState(false);
  const [pendingActionChipDismissed, setPendingActionChipDismissed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [activeGamesDelta, setActiveGamesDelta] = useState<number | null>(null);
  const wallet = useWalletStatus();
  const globalStoreRef = useRef<GlobalStateStore | null>(null);
  const walletSectionRef = useRef<HTMLDivElement | null>(null);
  const gamesSectionRef = useRef<HTMLElement | null>(null);
  const activityRailRef = useRef<HTMLDivElement | null>(null);
  const leaderboardSectionRef = useRef<HTMLElement | null>(null);
  const previousActiveGamesCountRef = useRef<number | null>(null);
  const previousWalletStatusRef = useRef(wallet.status);
  const previousReconnectAtRef = useRef(wallet.lastReconnectAt);

  if (!globalStoreRef.current) {
    globalStoreRef.current = new GlobalStateStore();
  }

  const [checklistDismissed, setChecklistDismissed] = useState<boolean>(
    () =>
      !!globalStoreRef.current?.selectFlag(ONBOARDING_CHECKLIST_DISMISSED_FLAG),
  );

  const handleDismissChecklist = useCallback(() => {
    globalStoreRef.current?.dispatch({
      type: "FLAGS_SET",
      payload: { key: ONBOARDING_CHECKLIST_DISMISSED_FLAG, value: true },
    });
    setChecklistDismissed(true);
  }, []);

  const networkSupport = useMemo(
    () =>
      isSupportedNetwork(wallet.network, {
        supportedNetworks: ["TESTNET", "PUBLIC"],
      }),
    [wallet.network],
  );

  const networkMismatch =
    wallet.capabilities.isConnected && !networkSupport.isSupported;

  const walletDiagnostics = useMemo(
    () => [
      {
        label: "Provider",
        value: wallet.provider?.name ?? "Unavailable",
        tone: wallet.provider ? ("success" as const) : ("warning" as const),
      },
      {
        label: "Network supported",
        value: networkSupport.isSupported,
        tone: networkSupport.isSupported
          ? ("success" as const)
          : ("error" as const),
      },
      {
        label: "Normalized network",
        value: networkSupport.normalizedActual ?? "Unknown",
      },
      {
        label: "Recovery pending",
        value: networkCheckPending,
        tone: networkCheckPending ? ("warning" as const) : ("neutral" as const),
      },
      {
        label: "Reconnect phase",
        value: wallet.refreshState.phase.toLowerCase().replace(/_/g, " "),
      },
      {
        label: "Last wallet sync",
        value: wallet.lastUpdatedAt
          ? new Date(wallet.lastUpdatedAt).toLocaleTimeString()
          : "Not synced",
      },
    ],
    [
      networkCheckPending,
      networkSupport.isSupported,
      networkSupport.normalizedActual,
      wallet.lastUpdatedAt,
      wallet.provider?.name,
      wallet.refreshState.phase,
    ],
  );

  const [activePlayGame, setActivePlayGame] = useState<Game | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const client = new ApiClient();
      const result = await client.getGames();

      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        setGames(result.data);
        setError(null);
        setLastGamesSyncAt(Date.now());
        return true;
      }

      setGames(ONCHAIN_GAMES_CATALOG);
      setError(null);
      setLastGamesSyncAt(Date.now());
      return true;
    } catch {
      setGames(ONCHAIN_GAMES_CATALOG);
      setError(null);
      setLastGamesSyncAt(Date.now());
      return true;
    }
  }, []);

  const handleStartPlay = useCallback((game: Game) => {
    setActivePlayGame(game);
  }, []);

  useEffect(() => {
    const run = async () => {
      await fetchGames();
      setLoading(false);
    };
    run();
  }, [fetchGames]);

  const handleRetryLoadGames = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await fetchGames();
    } finally {
      setRetrying(false);
    }
  }, [fetchGames, retrying]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 600px)");
    const updateMatch = () => setIsMobileViewport(mediaQuery.matches);
    updateMatch();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateMatch);
      return () => mediaQuery.removeEventListener("change", updateMatch);
    }

    mediaQuery.addListener(updateMatch);
    return () => mediaQuery.removeListener(updateMatch);
  }, []);

  useEffect(() => {
    const store = globalStoreRef.current!;
    setPendingTransaction(store.getState().pendingTransaction ?? null);
    return store.subscribe((state) => {
      setPendingTransaction(state.pendingTransaction ?? null);
    });
  }, []);

  useEffect(() => {
    if (pendingTransaction) {
      setPendingActionChipDismissed(false);
    }
  }, [pendingTransaction?.txHash, pendingTransaction?.updatedAt]);

  useEffect(() => {
    if (wallet.sessionDropped && pendingTransaction) {
      setShowPendingTaskBanner(true);
    }
  }, [pendingTransaction, wallet.sessionDropped]);

  const retryNetworkCheck = useCallback(async () => {
    if (networkCheckPending) return;
    setNetworkCheckPending(true);
    try {
      await wallet.refresh();
    } finally {
      setNetworkCheckPending(false);
    }
  }, [networkCheckPending, wallet]);

  const recoverNetwork = useCallback(async () => {
    await retryNetworkCheck();
  }, [retryNetworkCheck]);

  const scrollToElement = useCallback((element: HTMLElement | null) => {
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const persistLobbyContext = useCallback((context: LobbyContext) => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      sessionStorage.setItem(DASHBOARD_LAST_CONTEXT_KEY, context);
    } catch {
      // no-op
    }
  }, []);

  const scrollToContext = useCallback(
    (context: LobbyContext) => {
      persistLobbyContext(context);

      switch (context) {
        case "wallet-panel":
          scrollToElement(walletSectionRef.current);
          break;
        case "live-arena":
          scrollToElement(gamesSectionRef.current);
          break;
        case "leaderboard":
          scrollToElement(leaderboardSectionRef.current);
          break;
        case "activity-rail":
          scrollToElement(activityRailRef.current);
          break;
      }
    },
    [persistLobbyContext, scrollToElement],
  );

  const markQuickActionsUsed = useCallback(() => {
    setQuickActionsUsed(true);
    if (typeof window === "undefined") {
      return;
    }
    try {
      sessionStorage.setItem(DASHBOARD_COMMAND_SURFACE_USED_KEY, "true");
    } catch {
      // no-op
    }
  }, []);

  const openCommandCenter = useCallback(() => {
    markQuickActionsUsed();
    commandStore.dispatch({ type: "COMMAND_PALETTE_OPEN" });
  }, [markQuickActionsUsed]);

  const handleRefreshLobby = useCallback(async () => {
    markQuickActionsUsed();
    await handleRetryLoadGames();
  }, [handleRetryLoadGames, markQuickActionsUsed]);

  const activeGames = useMemo(
    () =>
      games.filter((game) => String(game.status).toLowerCase() === "active"),
    [games],
  );

  useEffect(() => {
    const previousCount = previousActiveGamesCountRef.current;
    if (previousCount !== null) {
      setActiveGamesDelta(activeGames.length - previousCount);
    }
    previousActiveGamesCountRef.current = activeGames.length;
  }, [activeGames.length]);

  const leaderboardRows = useMemo<LeaderboardRow[]>(
    () =>
      [...activeGames]
        .sort((left, right) => {
          const leftWager =
            typeof left.wager === "number"
              ? left.wager
              : Number(left.wager ?? 0);
          const rightWager =
            typeof right.wager === "number"
              ? right.wager
              : Number(right.wager ?? 0);
          return rightWager - leftWager;
        })
        .map((game, index) => ({
          rank: index + 1,
          id: game.id,
          name: game.name,
          status: String(game.status ?? "unknown"),
          wager:
            typeof game.wager === "number"
              ? game.wager
              : Number(game.wager ?? 0),
        })),
    [activeGames],
  );

  const leaderboardColumns = useMemo<DataTableColumn<LeaderboardRow>[]>(
    () => [
      { key: "rank", header: "Rank", sortable: true, width: "5rem" },
      { key: "name", header: "Game", sortable: true },
      { key: "status", header: "Status", sortable: true, width: "8rem" },
      {
        key: "wager",
        header: "Wager",
        sortable: true,
        width: "8rem",
        render: (row) => `${row.wager.toFixed(0)} XLM`,
        sortAccessor: (row) => row.wager,
      },
    ],
    [],
  );

  const totalPrizeSignal = useMemo(
    () =>
      activeGames.reduce((sum, game) => {
        const wager =
          typeof game.wager === "number" ? game.wager : Number(game.wager ?? 0);
        return Number.isFinite(wager) ? sum + wager : sum;
      }, 0),
    [activeGames],
  );

  const prizePoolState = useMemo(
    () =>
      totalPrizeSignal > 0
        ? {
            balance: totalPrizeSignal.toFixed(2),
            totalReserved: String(activeGames.length),
            admin: "",
          }
        : null,
    [activeGames.length, totalPrizeSignal],
  );

  const handleDensityChange = useCallback(
    (density: TableDensityPreference) => {
      setTableDensity(density);
      persistTableDensityPreference(DASHBOARD_DENSITY_SCOPE, density);
      persistLobbyContext("leaderboard");
    },
    [persistLobbyContext],
  );

  useEffect(() => {
    const previousStatus = previousWalletStatusRef.current;
    const previousReconnectAt = previousReconnectAtRef.current;

    if (
      previousStatus === "RECONNECTING" &&
      wallet.status === "CONNECTED" &&
      wallet.lastReconnectAt !== null &&
      wallet.lastReconnectAt !== previousReconnectAt
    ) {
      setPendingResumeContext(readStoredLobbyContext());
      if (pendingTransaction) {
        setShowPendingTaskBanner(true);
      }
    }

    previousWalletStatusRef.current = wallet.status;
    previousReconnectAtRef.current = wallet.lastReconnectAt;
  }, [pendingTransaction, wallet.lastReconnectAt, wallet.status]);

  const missionItems = useMemo(
    () => [
      {
        id: "connect-wallet",
        title: "Review wallet readiness",
        description:
          "Open the wallet panel to connect or verify the current network before you start a match.",
        complete: wallet.capabilities.isConnected,
        actionLabel: "Open wallet panel",
        onAction: () => scrollToContext("wallet-panel"),
      },
      {
        id: "scan-live-games",
        title: "Scan the live arena",
        description:
          "Jump to the active game grid and confirm which matches are open right now.",
        complete: games.length > 0,
        actionLabel: "Jump to games",
        onAction: () => scrollToContext("live-arena"),
      },
      {
        id: "learn-commands",
        title: "Try the dashboard command surface",
        description:
          "Launch the command center or use a quick action so common tasks stay close at hand.",
        complete: quickActionsUsed,
        actionLabel: "Open command center",
        onAction: openCommandCenter,
      },
    ],
    [
      games.length,
      openCommandCenter,
      quickActionsUsed,
      scrollToContext,
      wallet.capabilities.isConnected,
    ],
  );

  const quickActions = useMemo(
    () => [
      {
        id: "command-center",
        label: "Open command center",
        description: "Browse common dashboard actions and navigation shortcuts.",
        shortcutHint: "Ctrl+K",
        onSelect: openCommandCenter,
      },
      {
        id: "wallet-panel",
        label: "Review wallet panel",
        description: "Jump to wallet status, provider details, and network diagnostics.",
        onSelect: () => {
          markQuickActionsUsed();
          scrollToContext("wallet-panel");
        },
      },
      {
        id: "refresh-lobby",
        label: "Refresh live data",
        description: "Re-run the lobby fetch without leaving the current dashboard flow.",
        onSelect: handleRefreshLobby,
        disabled: retrying,
      },
      {
        id: "session-activity",
        label: "Open activity rail",
        description: "Review the latest wallet-session sync, tx, and lobby refresh events.",
        onSelect: () => {
          markQuickActionsUsed();
          scrollToContext("activity-rail");
        },
      },
    ],
    [handleRefreshLobby, markQuickActionsUsed, openCommandCenter, retrying, scrollToContext],
  );

  const mobileToolbarActions = useMemo<ToolbarAction[]>(
    () => [
      {
        id: "refresh-lobby",
        label: "Refresh",
        onClick: handleRefreshLobby,
        intent: "primary",
        isLoading: retrying,
      },
      {
        id: "open-command-center",
        label: "Commands",
        onClick: openCommandCenter,
        intent: "secondary",
      },
      pendingTransaction
        ? {
            id: "inspect-transaction",
            label: "Inspect tx",
            onClick: () => setIsTransactionDrawerOpen(true),
            intent: "tertiary",
          }
        : {
            id: "open-wallet-panel",
            label: "Wallet",
            onClick: () => scrollToContext("wallet-panel"),
            intent: "tertiary",
          },
    ],
    [
      handleRefreshLobby,
      openCommandCenter,
      pendingTransaction,
      retrying,
      scrollToContext,
    ],
  );

  const showMobileActionFooter = isMobileViewport && mobileToolbarActions.length > 0;
  const queueSummaryMetrics = useMemo(
    () => ({
      playersInQueue: activeGames.length * 4,
      averageWaitTime: activeGames.length > 0 ? 95 : 0,
      estimatedWaitTime: activeGames.length > 0 ? 70 : 0,
      activeMatches: activeGames.length,
      queueHealth:
        activeGames.length === 0
          ? ("offline" as const)
          : activeGames.length > 5
            ? ("healthy" as const)
            : ("degraded" as const),
      lastUpdated: new Date(lastGamesSyncAt ?? Date.now()).toISOString(),
    }),
    [activeGames.length, lastGamesSyncAt],
  );
  const compactLobbyStats = useMemo(
    () => [
      {
        id: "active-games",
        label: "Active games",
        value: activeGames.length,
        trend: activeGamesDelta === null ? undefined : activeGamesDelta >= 0 ? ("up" as const) : ("down" as const),
        change:
          activeGamesDelta === null
            ? undefined
            : `${activeGamesDelta > 0 ? "+" : ""}${activeGamesDelta}`,
        caption: "Compared with previous sync",
      },
      {
        id: "wallet-ready",
        label: "Wallet readiness",
        value: wallet.capabilities.isConnected ? "Connected" : "Not connected",
        caption: wallet.network ?? "No active network",
      },
      {
        id: "pending-actions",
        label: "Pending actions",
        value: pendingTransaction ? 1 : 0,
        caption: pendingTransaction ? "Resume from tx status panel" : "No pending wallet tx",
      },
      {
        id: "prize-signal",
        label: "Prize signal",
        value: `${totalPrizeSignal.toFixed(0)} XLM`,
      },
    ],
    [
      activeGames.length,
      activeGamesDelta,
      pendingTransaction,
      totalPrizeSignal,
      wallet.capabilities.isConnected,
      wallet.network,
    ],
  );
  const rewardTrendCards = useMemo(
    () => {
      if (games.length === 0) {
        return [];
      }
      const reserveSeries = [
        Math.max(totalPrizeSignal * 0.72, 0),
        Math.max(totalPrizeSignal * 0.8, 0),
        Math.max(totalPrizeSignal * 0.88, 0),
        totalPrizeSignal,
      ];
      const participationSeries = [
        Math.max(activeGames.length - 1, 0),
        activeGames.length,
        activeGames.length + (activeGamesDelta && activeGamesDelta > 0 ? 1 : 0),
        activeGames.length,
      ];
      return [
        {
          id: "prize-reserve",
          label: "Prize Reserve",
          balance: `${totalPrizeSignal.toFixed(0)} XLM`,
          balanceEquivalent: `${activeGames.length} live table${activeGames.length === 1 ? "" : "s"}`,
          dataPoints: reserveSeries,
          change:
            activeGamesDelta === null
              ? "0%"
              : `${activeGamesDelta > 0 ? "+" : ""}${Math.min(Math.abs(activeGamesDelta) * 5, 25)}%`,
          trend: activeGamesDelta !== null && activeGamesDelta < 0 ? ("down" as const) : ("up" as const),
        },
        {
          id: "arena-participation",
          label: "Arena Participation",
          balance: `${activeGames.length * 4} players`,
          balanceEquivalent: "Estimated queued + active players",
          dataPoints: participationSeries,
          change: queueSummaryMetrics.queueHealth === "healthy" ? "+8%" : "0%",
          trend:
            queueSummaryMetrics.queueHealth === "healthy"
              ? ("up" as const)
              : queueSummaryMetrics.queueHealth === "degraded"
                ? ("flat" as const)
                : ("down" as const),
        },
      ];
    },
    [
      activeGames.length,
      activeGamesDelta,
      games.length,
      queueSummaryMetrics.queueHealth,
      totalPrizeSignal,
    ],
  );

  const activityItems = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      summary: string;
      detail?: string;
      timestampLabel?: string;
      tone?: "neutral" | "info" | "success" | "warning" | "error";
    }> = [];

    if (lastGamesSyncAt) {
      items.push({
        id: "games-refresh",
        label: "Lobby refreshed",
        summary: `${games.length} game${games.length === 1 ? "" : "s"} were included in the latest dashboard sync.`,
        detail:
          games.length > 0
            ? `${activeGames.length} active match${activeGames.length === 1 ? "" : "es"} are ready to browse.`
            : "No live matches were available on the latest refresh.",
        timestampLabel: new Date(lastGamesSyncAt).toLocaleTimeString(),
        tone: games.length > 0 ? "success" : "neutral",
      });
    }

    if (wallet.lastUpdatedAt || wallet.capabilities.isConnected || wallet.error) {
      items.push({
        id: "wallet-session",
        label: "Wallet session",
        summary: wallet.capabilities.isConnected
          ? `Connected as ${formatCompactAddress(wallet.address)} on ${wallet.network ?? "an unknown network"}.`
          : wallet.error?.message ?? "No wallet session is connected yet.",
        detail: wallet.provider?.name
          ? `Provider: ${wallet.provider.name}`
          : "Open the wallet panel to connect and hydrate a session.",
        timestampLabel: wallet.lastUpdatedAt
          ? new Date(wallet.lastUpdatedAt).toLocaleTimeString()
          : "Awaiting sync",
        tone: wallet.capabilities.isConnected
          ? "success"
          : wallet.error
            ? "warning"
            : "neutral",
      });
    }

    if (pendingTransaction) {
      items.push({
        id: "pending-transaction",
        label: "Pending wallet action",
        summary: `${pendingTransaction.operation.replace(/\./g, " ")} is ${pendingTransaction.phase.toLowerCase().replace(/_/g, " ")}.`,
        detail: pendingTransaction.txHash
          ? `Tracking ${pendingTransaction.txHash.slice(0, 12)}...`
          : "Waiting for a transaction hash from the wallet session.",
        timestampLabel: new Date(pendingTransaction.updatedAt).toLocaleTimeString(),
        tone: "warning",
      });
    }

    if (networkMismatch || networkCheckPending) {
      items.push({
        id: "network-recovery",
        label: "Network recovery",
        summary: networkCheckPending
          ? "A network recovery check is running for the connected wallet."
          : `The wallet is on ${networkSupport.normalizedActual ?? "an unsupported network"}.`,
        detail:
          "Use the recovery controls to return to a supported network without leaving the lobby.",
        timestampLabel: networkCheckPending ? "Checking now" : "Needs action",
        tone: "error",
      });
    }

    return items;
  }, [
    activeGames.length,
    games.length,
    lastGamesSyncAt,
    networkCheckPending,
    networkMismatch,
    networkSupport.normalizedActual,
    pendingTransaction,
    wallet.address,
    wallet.capabilities.isConnected,
    wallet.error,
    wallet.lastUpdatedAt,
    wallet.network,
    wallet.provider?.name,
  ]);



  if (error) {
    return (
      <RecoverableErrorPanel
        title="Dashboard data is temporarily unavailable"
        message={`Failed to load games: ${error}`}
        description="You can retry inline, or open the wallet panel once the lobby reconnects."
        onRetry={handleRetryLoadGames}
        retryLabel={retrying ? "Retrying..." : "Retry"}
        retryDisabled={retrying}
        secondaryAction={{
          label: "Review wallet panel",
          onClick: () => scrollToContext("wallet-panel"),
        }}
        testId="lobby-error"
      />
    );
  }

  return (
    <div
      className={`game-lobby ${showMobileActionFooter ? "game-lobby--with-mobile-footer" : ""}`.trim()}
    >
      <header className="lobby-page-header">
        <div>
          <p className="lobby-page-header__eyebrow">StellarCade operations</p>
          <h1>Arcade Lobby</h1>
          <p>Monitor wallet readiness, live tables, and on-chain activity from one workspace.</p>
        </div>
        <div className="lobby-page-header__actions">
          <Button type="button" variant="outline" size="sm" onClick={openCommandCenter}>
            <Command /> Command center
          </Button>
          <Button type="button" variant="brand" size="sm" onClick={handleRefreshLobby} disabled={retrying}>
            <RefreshCw className={retrying ? "animate-spin" : undefined} /> Refresh
          </Button>
        </div>
      </header>

      {!checklistDismissed ? (
        <DashboardMissionStrip
          missions={missionItems}
          sessionLabel={isNewDashboardSession ? "New dashboard session" : "Dashboard session"}
          onDismiss={handleDismissChecklist}
        />
      ) : null}

      <section aria-label="Wallet and network status" className="lobby-dashboard">
        <div className="lobby-dashboard__col" ref={walletSectionRef}>
          <NetworkGuardBanner
            network={wallet.network}
            normalizedNetwork={networkSupport.normalizedActual}
            supportedNetworks={networkSupport.supportedNetworks}
            isSupported={!networkMismatch}
            onSwitchNetwork={recoverNetwork}
            onRetryNetworkCheck={retryNetworkCheck}
            actionLabel="Recover Network"
            retryLabel="Retry Check"
            dismissible={false}
            show={networkMismatch}
          />

          <WalletStatusCard
            status={wallet.status}
            address={wallet.address}
            network={wallet.network}
            provider={wallet.provider}
            capabilities={wallet.capabilities}
            error={wallet.error}
            // Bare connect() installs no provider (useWalletStatus only wires
            // one up when passed explicitly) — same bug fixed for the
            // header's wallet control (see HeaderWalletControl.tsx).
            onConnect={() => wallet.connect(defaultFreighterAdapter)}
            onDisconnect={wallet.disconnect}
            onRetry={wallet.refresh}
            onReconnect={wallet.refresh}
            droppedSession={wallet.sessionDropped}
            reconnectPending={wallet.status === "RECONNECTING"}
            reconnectProgress={wallet.status === "RECONNECTING" ? 65 : 0}
            reconnectProgressLabel="Restoring your wallet session"
            networkMismatch={networkMismatch}
            networkRecoveryPending={networkCheckPending}
            onRecoverNetwork={recoverNetwork}
            networkRecoveryLabel="Recover Network"
            lastUpdatedAt={wallet.lastUpdatedAt}
            isRefreshing={wallet.isRefreshing}
            diagnostics={walletDiagnostics}
          />
        </div>

        <div className="lobby-dashboard__col">
          <div className="lobby-header">
            <h2 id="games-heading">Live Arena</h2>
            <p>Real-time game status across the Stellar ecosystem.</p>
            <InlineStatDelta
              value={activeGamesDelta}
              label="active games vs last sync"
              className="lobby-header__delta"
            />
          </div>

          <QuickActionSurface actions={quickActions} />
          <QueueHealthWidget
            queueName="Queue participation summary"
            metrics={queueSummaryMetrics}
            size="compact"
            showDetails={false}
            refreshInterval={0}
            onRefresh={handleRefreshLobby}
            testId="lobby-queue-summary"
          />
          <div className="lobby-reward-trend-grid" data-testid="lobby-reward-trend-grid">
            {rewardTrendCards.length === 0 ? (
              <RewardBalanceSparklineCard
                label="Reward trend"
                status="loading"
                testId="lobby-reward-trend-loading"
              />
            ) : (
              rewardTrendCards.map((card) => (
                <RewardBalanceSparklineCard
                  key={card.id}
                  label={card.label}
                  balance={card.balance}
                  balanceEquivalent={card.balanceEquivalent}
                  dataPoints={card.dataPoints}
                  change={card.change}
                  trend={card.trend}
                  testId={`lobby-reward-trend-${card.id}`}
                />
              ))
            )}
          </div>
          <CollapsibleStatsGroup
            title="Compact lobby stats"
            summary={`${compactLobbyStats.length} metrics`}
            items={compactLobbyStats}
            defaultExpanded={false}
            testId="lobby-compact-stats"
          />

          {pendingResumeContext ? (
            <ResumeTaskBanner
              taskName={LOBBY_CONTEXT_LABELS[pendingResumeContext]}
              onResume={() => {
                scrollToContext(pendingResumeContext);
                setPendingResumeContext(null);
              }}
              onDismiss={() => setPendingResumeContext(null)}
              className="lobby-resume-banner"
              testId="lobby-resume-context-banner"
            />
          ) : null}

          {showPendingTaskBanner && pendingTransaction ? (
            <ResumeTaskBanner
              taskName={formatPendingTaskName(pendingTransaction)}
              onResume={() => {
                setIsTransactionDrawerOpen(true);
                setPendingActionChipDismissed(false);
                setShowPendingTaskBanner(false);
              }}
              onDismiss={() => setShowPendingTaskBanner(false)}
              className="lobby-resume-banner"
              testId="lobby-pending-task-banner"
            />
          ) : null}

          {pendingTransaction && !isTransactionDrawerOpen && !pendingActionChipDismissed ? (
            <PendingActionResumeChip
              label={formatPendingTaskName(pendingTransaction)}
              detail={`${pendingTransaction.phase.toLowerCase().replace(/_/g, " ")} in progress`}
              onResume={() => {
                setIsTransactionDrawerOpen(true);
                setPendingActionChipDismissed(false);
              }}
              onDismiss={() => setPendingActionChipDismissed(true)}
              testId="lobby-pending-action-chip"
            />
          ) : null}

          <div className="lobby-kpi-strip" data-testid="lobby-kpi-strip">
            <StatusCard
              id="wallet-kpi"
              name="Wallet"
              status={wallet.status}
              tone={wallet.capabilities.isConnected ? "success" : "neutral"}
              hideDefaultAction={true}
              bodySlot={
                <div className="status-card__metric-group">
                  <div className="status-card__metric-value">
                    {wallet.capabilities.isConnected ? "Connected" : "Offline"}
                  </div>
                  <div className="status-card__metric-note">
                    {formatCompactAddress(wallet.address)}
                  </div>
                  <div className="status-card__metric-caption">
                    {wallet.lastUpdatedAt
                      ? `Updated ${new Date(wallet.lastUpdatedAt).toLocaleTimeString()}`
                      : "No recent wallet sync"}
                  </div>
                </div>
              }
            />
            <StatusCard
              id="tx-kpi"
              name="Transactions"
              status={pendingTransaction ? pendingTransaction.phase : "idle"}
              tone={pendingTransaction ? "warning" : "neutral"}
              hideDefaultAction={true}
              footerSlot={
                <button
                  type="button"
                  className="btn-play"
                  onClick={() => setIsTransactionDrawerOpen(true)}
                  disabled={!pendingTransaction}
                  aria-label={
                    pendingTransaction
                      ? "Open transaction details"
                      : "Transaction details unavailable"
                  }
                  data-testid="transaction-detail-trigger"
                >
                  {pendingTransaction ? "Inspect tx" : "Awaiting tx"}
                </button>
              }
              bodySlot={
                <div className="status-card__metric-group">
                  <div className="status-card__metric-value">
                    {formatPendingTxLabel(pendingTransaction)}
                  </div>
                  <div className="status-card__metric-note">
                    {pendingTransaction?.txHash
                      ? `${pendingTransaction.txHash.slice(0, 10)}...`
                      : "No recent transaction hash"}
                  </div>
                  <div className="status-card__metric-caption">
                    {pendingTransaction
                      ? `Started ${new Date(pendingTransaction.startedAt).toLocaleTimeString()}`
                      : "Waiting for the next wallet action"}
                  </div>
                </div>
              }
            />
            <PrizePoolStateCard
              compact={true}
              state={prizePoolState}
              statusLabel={
                prizePoolState ? "Prize pool signal live" : "Awaiting prize-pool data"
              }
              footerMeta={
                activeGames.length > 0
                  ? `${activeGames.length} live game${activeGames.length === 1 ? "" : "s"}`
                  : null
              }
              emptyMessage="No prize-pool metrics available yet."
              testId="lobby-prize-pool-kpi"
            />
          </div>
        </div>
      </section>

      <div className="lobby-content-grid">
        <div className="lobby-content-grid__main">
          <section
            aria-labelledby="games-heading"
            className="games-section"
            ref={gamesSectionRef}
          >
            <QueueStateMiniPanel
              metrics={queueSummaryMetrics}
              context="lobby"
              onRefresh={handleRefreshLobby}
              testId="lobby-queue-mini-panel"
            />

            {games.length === 0 ? (
              <div className="lobby-empty" role="status" aria-live="polite">
                <div className="empty-icon">No live games</div>
                <p>No games active at the moment. Check back later!</p>
              </div>
            ) : (
              <div className="games-grid" role="region" aria-label="Active games">
                {games.map((game) => (
                  <StatusCard
                    key={game.id}
                    id={game.id}
                    name={game.name}
                    status={game.status}
                    wager={game.wager as number | undefined}
                    actionLabel="Play Now"
                    onAction={() => handleStartPlay(game)}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            aria-labelledby="leaderboard-heading"
            className="leaderboard-section"
            ref={leaderboardSectionRef}
          >
            <SectionHeader
              titleId="leaderboard-heading"
              title="Active Games Leaderboard"
              description="Switch between standard and compact density to scan live tables faster."
              headingLevel={2}
              actions={
                <SegmentedControl
                  label="Table density"
                  value={tableDensity}
                  onChange={handleDensityChange}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "compact", label: "Compact" },
                  ]}
                  testId="leaderboard-density"
                />
              }
            />

            <DataTable
              columns={leaderboardColumns}
              data={leaderboardRows}
              pageSize={5}
              density={tableDensity}
              emptyMessage="No leaderboard data available yet."
              searchable={true}
              searchPlaceholder="Search live games…"
              searchFn={(row, query) => [row.name, row.status, row.wager].some((value) => String(value).toLowerCase().includes(query))}
              ariaLabel="Active games leaderboard"
              testId="leaderboard-table"
            />
          </section>
        </div>

        <div className="lobby-content-grid__rail" ref={activityRailRef}>
          <WalletSessionActivityRail items={activityItems} />
        </div>
      </div>

      <TransactionDetailDrawer
        open={isTransactionDrawerOpen}
        onClose={() => setIsTransactionDrawerOpen(false)}
        pendingTransaction={pendingTransaction}
        network={wallet.network}
      />

      <Drawer
        open={Boolean(activePlayGame)}
        onClose={() => setActivePlayGame(null)}
        title={activePlayGame ? `Play ${activePlayGame.name}` : "Play Game"}
        side="right"
        testId="play-game-drawer"
      >
        {activePlayGame && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <p style={{ color: "var(--sc-text-dim, #94a3b8)", fontSize: "0.875rem", margin: 0 }}>
              {typeof activePlayGame.description === "string"
                ? activePlayGame.description
                : "Instant on-chain duel backed by Stellar smart contract and SHA-256 commit-reveal."}
            </p>

            <CoinFlipPlayPanel />
          </div>
        )}
      </Drawer>

      {showMobileActionFooter ? (
        <ActionToolbar
          actions={mobileToolbarActions}
          mobileSticky={true}
          className="game-lobby__mobile-action-footer"
          testId="lobby-mobile-action-footer"
        />
      ) : null}
    </div>
  );
};

export default GameLobby;
