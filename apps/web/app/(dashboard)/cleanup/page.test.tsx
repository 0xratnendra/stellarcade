import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import CleanupPage from "./page";

vi.mock("../../../src/services/account-cleanup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/services/account-cleanup")>();
  return {
    ...actual,
    getCleanupConfig: vi.fn().mockReturnValue({
      horizonUrl: "https://horizon-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    }),
    buildCleanupTransaction: vi.fn().mockResolvedValue({
      toXDR: () => "mock-xdr",
    }),
    calculateReclaimedXlm: vi.fn().mockReturnValue(1.0),
  };
});

vi.mock("../../../src/services/freighter-adapter", () => ({
  default: {
    signTransaction: vi.fn().mockResolvedValue("mock-signed-xdr"),
  },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: class {
      loadAccount = vi.fn().mockResolvedValue({});
      submitTransaction = vi.fn().mockResolvedValue({ hash: "mock-tx-hash-12345" });
    },
  },
  TransactionBuilder: {
    fromXDR: vi.fn().mockReturnValue({}),
  },
}));

describe("CleanupPage", () => {
  it("renders page title and scan input", () => {
    render(<CleanupPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /Cleanup & Reserve Recovery/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("input-hygiene-address")).toBeInTheDocument();
    expect(screen.getByTestId("btn-scan-account")).toBeInTheDocument();
  });

  it("displays subentries and allows selecting and reclaiming reserves", async () => {
    render(<CleanupPage />);
    expect(screen.getByTestId("stat-total-subentries")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-reclaimable-xlm")).toHaveTextContent("+1.5 XLM");

    // All cleanable are selected by default (3 items = 1.5 XLM)
    expect(screen.getByTestId("stat-selected-xlm")).toHaveTextContent("+1.5 XLM");

    // Toggle select one off
    const checkbox = screen.getByTestId("checkbox-tl-stale-arcade-token");
    fireEvent.click(checkbox);

    // Selected drops to 2 items = 1.0 XLM
    expect(screen.getByTestId("stat-selected-xlm")).toHaveTextContent("+1.0 XLM");

    // Click execute cleanup
    const executeBtn = screen.getByTestId("btn-execute-cleanup");
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(screen.getByTestId("reclaim-success-banner")).toBeInTheDocument();
    });
  });
});
