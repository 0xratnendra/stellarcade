import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { commandStore } from "./CommandPalette";
import GameLobby from "./GameLobby";
import { ONBOARDING_CHECKLIST_DISMISSED_FLAG } from "../services/global-state-store";
import { ApiClient } from "../services/typed-api-sdk";

vi.mock("../services/typed-api-sdk");

const walletState = vi.hoisted(() => ({
  status: "DISCONNECTED",
  address: null,
  network: null,
  provider: null,
  capabilities: {
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    canConnect: true,
  },
  error: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
  refresh: vi.fn(),
  isRefreshing: false,
  lastUpdatedAt: null,
  refreshState: {
    phase: "IDLE",
    trigger: "silent",
    attempt: 0,
    maxAttempts: 1,
    terminal: false,
  },
  sessionDropped: false,
  lastReconnectAt: null as number | null,
}));

vi.mock("../hooks/useWalletStatus", () => ({
  useWalletStatus: () => walletState,
}));

const networkGuard = vi.hoisted(() => ({ isSupported: true }));

vi.mock("../utils/useNetworkGuard", () => ({
  isSupportedNetwork: () => ({
    isSupported: networkGuard.isSupported,
    normalizedActual: "TESTNET",
    supportedNetworks: ["TESTNET", "PUBLIC"],
  }),
}));

const coinFlip = vi.hoisted(() => ({ placeBet: vi.fn() }));

vi.mock("../services/coin-flip-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/coin-flip-client")>()),
  placeBet: coinFlip.placeBet,
}));

vi.mock("../hooks/useCoinFlipGame", () => ({
  useCoinFlipGame: (gameId: bigint | null) => ({ status: gameId === null ? "idle" : "pending" }),
}));

beforeEach(() => {
  networkGuard.isSupported = true;
  coinFlip.placeBet.mockReset();
  localStorage.clear();
  sessionStorage.clear();
  commandStore.dispatch({ type: "COMMAND_PALETTE_CLOSE" });
  walletState.status = "DISCONNECTED";
  walletState.address = null;
  walletState.network = null;
  walletState.provider = null;
  walletState.capabilities = {
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    canConnect: true,
  };
  walletState.error = null;
  walletState.connect = vi.fn();
  walletState.disconnect = vi.fn();
  walletState.refresh = vi.fn();
  walletState.isRefreshing = false;
  walletState.lastUpdatedAt = null;
  walletState.refreshState = {
    phase: "IDLE",
    trigger: "silent",
    attempt: 0,
    maxAttempts: 1,
    terminal: false,
  };
  walletState.sessionDropped = false;
  walletState.lastReconnectAt = null;
});

test("renders GameLobby and fetches games", async () => {
  (ApiClient as any).prototype.getGames.mockResolvedValue({
    success: true,
    data: [{ id: "123456789", name: "Elite Clash", status: "active", wager: 50 }],
  });

  render(<GameLobby />);

  await waitFor(() => {
    expect(screen.getAllByText(/Elite Clash/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50 XLM/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/#12345678/i)).toBeDefined();
  });
});

describe("GameLobby", () => {
  it("renders the mission strip for a first-time dashboard session", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({ success: true, data: [] });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-mission-strip")).toBeInTheDocument();
      expect(screen.getByText(/new dashboard session/i)).toBeInTheDocument();
    });
  });

  it("does not render the mission strip when the dismissed flag is set", async () => {
    localStorage.setItem(
      "stc_global_state_v1",
      JSON.stringify({
        auth: { isAuthenticated: false },
        flags: { [ONBOARDING_CHECKLIST_DISMISSED_FLAG]: true },
        storedAt: Date.now(),
      }),
    );
    (ApiClient as any).prototype.getGames.mockResolvedValue({ success: true, data: [] });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-mission-strip")).not.toBeInTheDocument();
    });
  });

  it("marks the command mission complete after using the quick-action surface", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({ success: true, data: [] });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-mission-strip-learn-commands")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("quick-action-surface-command-center"));

    expect(commandStore.selectCommandPaletteOpen()).toBe(true);
    expect(screen.getByTestId("dashboard-mission-strip-learn-commands")).toHaveTextContent(/complete/i);
  });

  it("restores compact leaderboard density from persisted preference", async () => {
    localStorage.setItem("stc_table_density_v1_dashboard-surfaces", "compact");
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "g1", name: "Game One", status: "active", wager: 25 }],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("leaderboard-table")).toHaveClass("data-table--compact");
    });

    expect(screen.getByTestId("leaderboard-density-compact")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders queue participation summary widget in live lobby flow", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "g1", name: "Game One", status: "active", wager: 25 }],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-queue-summary")).toBeInTheDocument();
      expect(screen.getByText(/Queue participation summary/i)).toBeInTheDocument();
    });
  });

  it("prompts the user to return to the last context after reconnecting", async () => {
    sessionStorage.setItem("stc_dashboard_last_context_v1", "activity-rail");
    walletState.status = "RECONNECTING";
    walletState.capabilities = {
      isConnected: false,
      isConnecting: false,
      isReconnecting: true,
      canConnect: false,
    };
    walletState.lastReconnectAt = 1_700_000_000_000;

    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "g1", name: "Game One", status: "active", wager: 25 }],
    });

    const { rerender } = render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByText("Live Arena")).toBeInTheDocument();
    });

    walletState.status = "CONNECTED";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    walletState.lastReconnectAt = 1_700_000_000_500;
    rerender(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-resume-context-banner")).toHaveTextContent(
        /wallet activity rail/i,
      );
    });

    fireEvent.click(screen.getByTestId("lobby-resume-context-banner-dismiss-btn"));
    expect(screen.queryByTestId("lobby-resume-context-banner")).not.toBeInTheDocument();
  });

  it("shows a pending-action resume chip for interrupted transaction flows", async () => {
    localStorage.setItem(
      "stc_global_state_v1",
      JSON.stringify({
        auth: { isAuthenticated: false },
        flags: {},
        pendingTransaction: {
          operation: "wallet.deposit",
          phase: "SUBMITTING",
          txHash: "abc1234567890",
          startedAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_500,
        },
        storedAt: Date.now(),
      }),
    );
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "g1", name: "Game One", status: "active", wager: 25 }],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-pending-action-chip")).toHaveTextContent(
        /wallet deposit/i,
      );
    });

    fireEvent.click(screen.getByTestId("lobby-pending-action-chip-resume-btn"));
    expect(screen.getByTestId("transaction-detail-drawer")).toBeInTheDocument();
  });

  it("lets the user dismiss the pending-action chip", async () => {
    localStorage.setItem(
      "stc_global_state_v1",
      JSON.stringify({
        auth: { isAuthenticated: false },
        flags: {},
        pendingTransaction: {
          operation: "wallet.deposit",
          phase: "SUBMITTING",
          txHash: "abc1234567890",
          startedAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_500,
        },
        storedAt: Date.now(),
      }),
    );
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "g1", name: "Game One", status: "active", wager: 25 }],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-pending-action-chip")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("lobby-pending-action-chip-dismiss-btn"));
    expect(screen.queryByTestId("lobby-pending-action-chip")).not.toBeInTheDocument();
  });

  it("renders the queue-state mini panel in the lobby live arena section", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [
        { id: "g1", name: "Game One", status: "active", wager: 25 },
        { id: "g2", name: "Game Two", status: "active", wager: 10 },
      ],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-queue-mini-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("lobby-queue-mini-panel")).toHaveClass(
      "queue-state-mini-panel--lobby",
    );
  });

  it("queue-state mini panel shows offline when no active games are present", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-queue-mini-panel")).toBeInTheDocument();
    });

    expect(screen.getByTestId("lobby-queue-mini-panel-health")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });

  it("renders compact expandable stats and reward trend fallback when no games are loaded", async () => {
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [],
    });

    render(<GameLobby />);

    await waitFor(() => {
      expect(screen.getByTestId("lobby-compact-stats")).toBeInTheDocument();
      expect(screen.getByTestId("lobby-reward-trend-loading")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("lobby-compact-stats-toggle"));
    expect(screen.getByTestId("lobby-compact-stats-panel")).not.toHaveAttribute("hidden");
  });
});

describe("GameLobby coin-flip play", () => {
  const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID", "CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5");
    vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
    vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
    walletState.status = "CONNECTED";
    (walletState as { address: string | null }).address = PLAYER;
    (walletState as { network: string | null }).network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    (ApiClient as any).prototype.getGames.mockResolvedValue({
      success: true,
      data: [{ id: "coin-flip", name: "Coin Flip", status: "active", wager: 5 }],
    });
  });

  async function openPlayDrawer() {
    render(<GameLobby />);
    const playButtons = await screen.findAllByRole("button", { name: /Play Now/i });
    fireEvent.click(playButtons[0]);
    return screen.findByTestId("btn-confirm-bet");
  }

  it("places a real bet and shows it as pending with the game id and tx hash", async () => {
    const randomSpy = vi.spyOn(Math, "random");
    coinFlip.placeBet.mockResolvedValue({ gameId: 9876543210n, txHash: "c".repeat(64) });

    fireEvent.click(await openPlayDrawer());

    expect(await screen.findByTestId("coinflip-live-result")).toBeInTheDocument();
    expect(coinFlip.placeBet).toHaveBeenCalledWith({ player: PLAYER, side: 0, wagerXlm: "5" });
    expect(screen.getByTestId("coinflip-outcome")).toHaveTextContent(/waiting for the result/i);
    expect(screen.getByText(/9876543210/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bet transaction/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${"c".repeat(64)}`,
    );
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it("a rejected signature leaves no pending game and shows the rejection", async () => {
    const { CoinFlipBetError } = await import("../services/coin-flip-client");
    const { toAppError } = await import("../utils/errorMapper");
    const { RejectedSignatureError } = await import("../types/wallet-session");
    coinFlip.placeBet.mockRejectedValue(new CoinFlipBetError(toAppError(new RejectedSignatureError())));

    fireEvent.click(await openPlayDrawer());

    expect(await screen.findByTestId("bet-error")).toHaveTextContent("Transaction was rejected by the user.");
    expect(screen.queryByTestId("coinflip-live-result")).not.toBeInTheDocument();
  });

  it("blocks betting on the wrong network without asking to sign", async () => {
    networkGuard.isSupported = false;

    fireEvent.click(await openPlayDrawer());

    expect(await screen.findByTestId("bet-error")).toHaveTextContent(/Switch Freighter/i);
    expect(coinFlip.placeBet).not.toHaveBeenCalled();
  });
});
