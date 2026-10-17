import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HistoryPage from "./history/page";
import LeaderboardPage from "./leaderboard/page";
import QuestsPage from "./quests/page";
import RewardsPage from "./rewards/page";
import TournamentsPage from "./tournaments/page";

/**
 * Guard against sample data creeping back into player-facing surfaces.
 *
 * These pages all shipped with hardcoded demo arrays — leaderboard standings,
 * settled matches, tournament prize pools, quest XP, claimable rewards. On a
 * wagering UI those read as real balances and real standings, so each page
 * now sources from services/player-data (which returns empty until the
 * backing endpoints exist) and renders an empty state instead.
 */

const PAGES = [
  {
    name: "leaderboard",
    Page: LeaderboardPage,
    empty: /Nobody on the board yet/i,
  },
  { name: "history", Page: HistoryPage, empty: /No rounds settled yet/i },
  {
    name: "tournaments",
    Page: TournamentsPage,
    empty: /No tournaments scheduled yet/i,
  },
  { name: "rewards", Page: RewardsPage, empty: /No rewards to claim yet/i },
] as const;

/** Figures that appeared in the removed demo fixtures. */
const REMOVED_FIXTURES = [
  "NeonViper",
  "SorobanWhale",
  "QuantumFlip",
  "StellarGhost",
  "CipherRoll",
  "Weekly Soroban High-Roller Gauntlet",
  "Daily Coinflip Blitz Invitational",
  "Dice Masters Seasonal Open",
  "Provable Fairness Auditor",
  "Arcade Gladiator",
  "Community Vault Season 1 Jackpot",
];

describe.each(PAGES)("$name page with no data source", ({ Page, empty }) => {
  it("renders an empty state explaining what is missing", () => {
    render(<Page />);
    expect(screen.getByText(empty)).toBeInTheDocument();
  });

  it("renders none of the removed demo fixtures", () => {
    const { container } = render(<Page />);
    const text = container.textContent ?? "";
    for (const fixture of REMOVED_FIXTURES) {
      expect(text).not.toContain(fixture);
    }
  });

  it("shows no XLM balance figure", () => {
    const { container } = render(<Page />);
    // Any "<number> XLM" on these pages would be an invented amount: none of
    // them has a funded source yet.
    expect(container.textContent ?? "").not.toMatch(/\d[\d,.]*\s*XLM/);
  });
});

describe("quests page", () => {
  it("starts a new account at zero XP rather than a seeded balance", () => {
    render(<QuestsPage />);
    // Previously opened at 450 XP for an account that had earned nothing.
    expect(screen.getByText(/^0 XP$/)).toBeInTheDocument();
  });
});
