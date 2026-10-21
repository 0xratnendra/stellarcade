import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CoinFlipPlayPanel from "./CoinFlipPlayPanel";

const walletState = vi.hoisted(() => ({
  status: "DISCONNECTED",
  address: null as string | null,
  network: null as string | null,
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

const gameHook = vi.hoisted(() => ({
  state: { status: "pending" } as Record<string, unknown>,
}));

vi.mock("../hooks/useCoinFlipGame", () => ({
  useCoinFlipGame: (gameId: bigint | null) =>
    gameId === null ? { status: "idle" } : gameHook.state,
}));

const PLAYER = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";

beforeEach(() => {
  networkGuard.isSupported = true;
  coinFlip.placeBet.mockReset();
  gameHook.state = { status: "pending" };
  walletState.status = "DISCONNECTED";
  walletState.address = null;
  walletState.network = null;
  walletState.capabilities = {
    isConnected: false,
    isConnecting: false,
    isReconnecting: false,
    canConnect: true,
  };
  walletState.connect = vi.fn();
  vi.stubEnv("NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID", "CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5");
  vi.stubEnv("NEXT_PUBLIC_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
  vi.stubEnv("NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");
});

describe("CoinFlipPlayPanel", () => {
  it("renders pick and wager controls and a confirm button", () => {
    render(<CoinFlipPlayPanel />);

    expect(screen.getByTestId("btn-pick-heads")).toBeInTheDocument();
    expect(screen.getByTestId("btn-pick-tails")).toBeInTheDocument();
    expect(screen.getByTestId("btn-confirm-bet")).toBeInTheDocument();
    expect(screen.getByTestId("btn-confirm-bet")).toHaveTextContent("Connect Wallet & Play");
  });

  it("connects the wallet when not connected and the confirm button is clicked", async () => {
    render(<CoinFlipPlayPanel />);

    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(walletState.connect).toHaveBeenCalledOnce();
    expect(coinFlip.placeBet).not.toHaveBeenCalled();
  });

  it("places a real on-chain bet with the selected side and wager", async () => {
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    coinFlip.placeBet.mockResolvedValue({ gameId: 9876543210n, txHash: "c".repeat(64) });

    render(<CoinFlipPlayPanel />);

    fireEvent.click(screen.getByTestId("btn-pick-tails"));
    fireEvent.click(screen.getByRole("button", { name: "10" }));
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("coinflip-live-result")).toBeInTheDocument();
    expect(coinFlip.placeBet).toHaveBeenCalledWith({
      player: PLAYER,
      side: 1,
      wagerXlm: "10",
    });
    expect(screen.getByTestId("coinflip-outcome")).toHaveTextContent(/waiting for the result/i);
    expect(screen.getByText(/9876543210/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bet transaction/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${"c".repeat(64)}`,
    );
    // Pending round: nothing to verify yet, but the explainer is one click away.
    expect(screen.getByTestId("coinflip-fairness-link")).toHaveAttribute("href", "/verify#how-it-works");
    expect(screen.queryByTestId("coinflip-verify-link")).not.toBeInTheDocument();
  });

  it("links to the round verifier next to the fairness explainer once resolved", async () => {
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    coinFlip.placeBet.mockResolvedValue({ gameId: 7n, txHash: "b".repeat(64) });
    gameHook.state = {
      status: "resolved",
      game: { side: 1, wager: 10_0000000n, won: true, payout: 19_5000000n, refunded: false },
      resolveTxHash: "d".repeat(64),
    };

    render(<CoinFlipPlayPanel />);
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("coinflip-live-result")).toBeInTheDocument();
    expect(screen.getByTestId("coinflip-verify-link")).toHaveAttribute("href", "/verify?requestId=7");
    expect(screen.getByTestId("coinflip-fairness-link")).toHaveAttribute("href", "/verify#how-it-works");
    expect(screen.getByRole("link", { name: /Resolution transaction/i })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${"d".repeat(64)}`,
    );
  });

  it("never uses Math.random for the bet outcome", async () => {
    const randomSpy = vi.spyOn(Math, "random");
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    coinFlip.placeBet.mockResolvedValue({ gameId: 1n, txHash: "a".repeat(64) });

    render(<CoinFlipPlayPanel />);
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("coinflip-live-result")).toBeInTheDocument();
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it("shows a rejection error and leaves no pending game when the signature is rejected", async () => {
    const { CoinFlipBetError } = await import("../services/coin-flip-client");
    const { toAppError } = await import("../utils/errorMapper");
    const { RejectedSignatureError } = await import("../types/wallet-session");
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    coinFlip.placeBet.mockRejectedValue(
      new CoinFlipBetError(toAppError(new RejectedSignatureError())),
    );

    render(<CoinFlipPlayPanel />);
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("bet-error")).toHaveTextContent(
      "Transaction was rejected by the user.",
    );
    expect(screen.queryByTestId("coinflip-live-result")).not.toBeInTheDocument();
  });

  it("blocks betting on the wrong network without asking to sign", async () => {
    networkGuard.isSupported = false;
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "WRONGNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };

    render(<CoinFlipPlayPanel />);
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("bet-error")).toHaveTextContent(/Switch Freighter/i);
    expect(coinFlip.placeBet).not.toHaveBeenCalled();
  });

  it("supports a testIdSuffix for all interactive elements", () => {
    render(<CoinFlipPlayPanel testIdSuffix="-arena" />);

    expect(screen.getByTestId("btn-pick-heads-arena")).toBeInTheDocument();
    expect(screen.getByTestId("btn-pick-tails-arena")).toBeInTheDocument();
    expect(screen.getByTestId("btn-confirm-bet-arena")).toBeInTheDocument();
  });

  it("side selection uses radio inputs: arrow keys move between Heads and Tails", async () => {
    const user = userEvent.setup();
    render(<CoinFlipPlayPanel />);

    const headsRadio = screen.getByRole("radio", { name: "Heads" });
    const tailsRadio = screen.getByRole("radio", { name: "Tails" });

    // Heads is selected by default.
    expect(headsRadio).toBeChecked();
    expect(tailsRadio).not.toBeChecked();

    // Tab into the radio group, then arrow to Tails.
    await user.click(headsRadio);
    await user.keyboard("{ArrowRight}");

    expect(tailsRadio).toBeChecked();
    expect(headsRadio).not.toBeChecked();
  });

  it("announces status changes through the polite live region", async () => {
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    // Never settle so the live region stays visible long enough to assert.
    coinFlip.placeBet.mockReturnValue(new Promise(() => {}));

    render(<CoinFlipPlayPanel />);

    const statusRegion = screen.getByTestId("coinflip-status");
    expect(statusRegion).toHaveTextContent("");

    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(statusRegion).toHaveTextContent(/placing bet/i);
  });

  it("submit button exposes aria-busy while executing and aria-describedby on error", async () => {
    networkGuard.isSupported = false;
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "WRONGNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };

    render(<CoinFlipPlayPanel />);
    const btn = screen.getByTestId("btn-confirm-bet");

    // Not busy before click.
    expect(btn).not.toHaveAttribute("aria-busy", "true");

    fireEvent.click(btn);

    // Error is present; button links to it.
    await screen.findByTestId("bet-error");
    const errorEl = screen.getByTestId("bet-error");
    expect(btn).toHaveAttribute("aria-describedby", errorEl.id);
  });

  it("calls onBetPlaced after a successful bet", async () => {
    const onBetPlaced = vi.fn();
    walletState.status = "CONNECTED";
    walletState.address = PLAYER;
    walletState.network = "TESTNET";
    walletState.capabilities = {
      isConnected: true,
      isConnecting: false,
      isReconnecting: false,
      canConnect: false,
    };
    coinFlip.placeBet.mockResolvedValue({ gameId: 42n, txHash: "b".repeat(64) });

    render(<CoinFlipPlayPanel onBetPlaced={onBetPlaced} />);
    fireEvent.click(screen.getByTestId("btn-confirm-bet"));

    expect(await screen.findByTestId("coinflip-live-result")).toBeInTheDocument();
    expect(onBetPlaced).toHaveBeenCalledWith({ gameId: 42n, txHash: "b".repeat(64) });
  });
});
