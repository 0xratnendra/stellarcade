import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ProvableSeedHistoryDrawer } from "./ProvableSeedHistoryDrawer";
import { SeedHistoryEntry } from "./types";

const mockSeeds: SeedHistoryEntry[] = [
  {
    id: "seed_1",
    clientSeed: "client_abc_123",
    serverSeedHash: "hash_server_456_789_abcdef",
    nonceCount: 42,
    createdAt: "2026-09-27T10:00:00Z",
    status: "active",
  },
  {
    id: "seed_2",
    clientSeed: "client_old_999",
    serverSeedHash: "hash_server_old_111_222",
    nonceCount: 15,
    createdAt: "2026-09-26T10:00:00Z",
    status: "rotated",
    explorerUrl: "https://stellar.expert/explorer/testnet",
  },
];

describe("ProvableSeedHistoryDrawer", () => {
  it("drawer visibility toggles based on isOpen prop", () => {
    const { rerender } = render(
      <ProvableSeedHistoryDrawer
        isOpen={false}
        seeds={mockSeeds}
        onRotateSeed={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveClass("open");

    rerender(
      <ProvableSeedHistoryDrawer
        isOpen={true}
        seeds={mockSeeds}
        onRotateSeed={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(dialog).toHaveClass("open");
  });

  it("clicking rotate button invokes onRotateSeed", () => {
    const onRotateSeed = vi.fn();
    render(
      <ProvableSeedHistoryDrawer
        isOpen={true}
        seeds={mockSeeds}
        onRotateSeed={onRotateSeed}
        onClose={vi.fn()}
      />
    );

    const rotateBtn = screen.getByRole("button", { name: "Rotate Client Seed" });
    fireEvent.click(rotateBtn);

    expect(onRotateSeed).toHaveBeenCalledTimes(1);
  });

  it("seed history renders correct item count", () => {
    render(
      <ProvableSeedHistoryDrawer
        isOpen={true}
        seeds={mockSeeds}
        onRotateSeed={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Seed History (2)")).toBeInTheDocument();
  });
});
