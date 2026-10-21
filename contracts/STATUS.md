# Contract Status

An honest, current classification of every contract crate in this workspace,
generated 2026-08-10. `CLAUDE.md`'s existing status table predates this and
is **stale** — it was written when the repo had no workspace `Cargo.toml`
and described `coin-flip`/`prize-pool`/`random-generator` as stubs. All
three are now substantial (400–1450 lines) with real logic. That table
should be updated or removed the next time someone touches `CLAUDE.md`.

## Methodology (and its limits)

151 crates were scanned programmatically:

- Line count of `src/lib.rs`
- Presence of `todo!()` / `unimplemented!()` / literal `TODO` comments
- Presence of `#[test]` blocks (a proxy for test coverage, not quality)
- Explicit placeholder language (`"for now"`, `"would be populated"`,
  `"empty state"`, `"placeholder"`, `"not yet implement"`) — this caught
  `#[contractimpl]` blocks but return hardcoded zero/empty structs

**This is a heuristic, not a manual code review of 151 crates** — some
classifications are almost certainly wrong at the margins (see
`leaderboard` below for one caught-and-corrected example). Treat this as a
starting map, not ground truth; re-classify a crate by hand before relying
on its status for a real decision.

Rule:
- **stub** — <70 lines, OR contains placeholder language
- **implemented** — has `#[test]` blocks, ≥150 lines, zero `todo!`/`TODO`
- **partial** — everything else (real logic present, but untested and/or
  has open `TODO`s and/or under the "implemented" size bar)

## Results

| Status | Count |
|---|---|
| implemented | 39 |
| partial | 78 |
| stub | 34 |

## Build health (found and fixed during this audit)

**The entire workspace failed to resolve its dependency graph before this
pass** — `cargo check --workspace` errored on a `curve25519-dalek` version
conflict before compiling a single crate. Root cause: 8 near-empty stub
crates (`arena-reserves`, `badge-claims-v2`, `badge-ledger`,
`ladder-payouts`, `payout-checkpoints`, `raffle-escrow`, `sponsor-payouts`,
`treasury-streams` — all under 55 lines) were pinned to `soroban-sdk =
"20.0.0"` while the other 138 crates use `"25.0.2"`, and Cargo's workspace
resolver couldn't satisfy both simultaneously. **Fixed**: bumped all 8 to
`25.0.2`, matching the rest of the workspace. This was a mechanical,
low-risk fix (all 8 are stub crates with no real logic depending on the old
API surface).

After that fix: **149 of 151 crates compile clean** (`cargo check
--workspace`). Two do not:

- `badge-minter` — uses `#[contractevent]` / `#[topic]`, which don't exist
  in whatever soroban-sdk version this crate's dependency actually resolves
  to (`E0432: unresolved import`). Needs its Cargo.toml checked against the
  workspace's `25.0.2` and its event-emission code updated to match that
  version's API.
- `season-rewards-vault` — same `#[contractevent]`/`#[topic]` issue, plus a
  `#[contractimpl]` function taking a `usize` parameter, which Soroban's
  contract macro doesn't support (needs `u32`/`u64`/etc).

Neither was touched in this pass — they're real code-level fixes, not
mechanical version bumps, and deserve their own PR with tests.

## The 12 contracts proposed for v1

Per `ANTIGRAVITY-BUILD-PROMPT.md`. Current classification, not aspirational:

| Contract | Status | What's needed for v1 |
|---|---|---|
| `random-generator` | implemented | Already has 32 tests — review for the provably-fair RNG design, add fuzz/property tests |
| `treasury` | implemented | 13 tests — review access control paths |
| `quest-ledger-v2` | implemented | 4 tests — review edge cases (streak resets, double-claims) |
| `access-control` | partial | Real RBAC logic, **zero tests** — write the test suite before calling this v1-ready |
| `coin-flip` | partial | Real logic (exposure tracking, recent-game history), zero tests |
| `dice-roll` | partial | Zero tests |
| `higher-lower` | partial | Zero tests; also currently **excluded from the workspace build** — check why before adding tests |
| `number-guess` | partial | 1 open TODO, zero tests |
| `trivia-game` | partial | 2 open TODOs, 3 tests — close the TODOs |
| `pattern-puzzle` | partial | 1022 lines, 13 tests, 4 open TODOs — closest to done of the partials, resolve the TODOs |
| `prize-pool` | partial | Zero tests — this contract moves money, treat the missing tests as a blocker, not a nice-to-have |
| `leaderboard` | partial (manually reclassified) | The heuristic flagged this as a stub over one placeholder comment on a batch-update helper; the bulk of the contract (score submission, ranking) is real. Zero tests either way. |

**None of the 12 are "implemented" in the sense of "done, tested,
production-ready."** Three have real test coverage and should be reviewed
rather than rewritten; the other nine have real logic but need a test suite
before anyone should call them v1-ready. That is the honest state of this
list, not a downgrade from the build prompt's plan — the plan already said
"bring those to production quality," this file is what "not yet at that
quality" looks like concretely.

## On the "move non-v1 contracts to contracts/incubator/" idea

`ANTIGRAVITY-BUILD-PROMPT.md` proposed physically moving the ~139
non-shortlisted crates into `contracts/incubator/`. **Not done in this
pass.** This repo has a live 960-commit history, two remotes, and an
existing (now-fixed) workspace `Cargo.toml` with an explicit `members` list
and `exclude` list that CI presumably depends on. Moving 139 directories is
a large, mechanical, hard-to-cleanly-revert change with real risk of
breaking CI or in-flight branches, for a benefit (tidier directory listing)
that doesn't require the move — `STATUS.md`'s table above gives the same
signal without touching the working tree structure at all. If a maintainer
wants the physical move later, this file's classification is the input list
for it.

## Full classification

Machine-generated from the scan above. `?` in the Tests column means
`#[test]` blocks weren't found by the grep (again: a proxy, not proof of
coverage).

| Contract | Lines | TODOs | Tests | Status |
|---|---|---|---|---|
| `access-control` | 174 | 0 | 0 | partial |
| `achievement-badge` | 920 | 0 | 24 | implemented |
| `achievements` | 55 | 0 | 0 | stub |
| `affiliate-ledger` | 326 | 0 | 0 | partial |
| `ai-generated-game` | 491 | 0 | 5 | implemented |
| `anti-cheat-bounties` | 242 | 0 | 0 | partial |
| `arena-ladder` | 179 | 0 | 0 | partial |
| `arena-reserves` | 54 | 0 | 0 | stub |
| `arena-sessions` | 290 | 0 | 0 | partial |
| `asset-escrow-v3` | 239 | 0 | 0 | stub |
| `attendance-pass` | 321 | 0 | 5 | implemented |
| `badge-claims-v2` | 54 | 0 | 0 | stub |
| `badge-ledger` | 17 | 0 | 0 | stub |
| `badge-minter` | 711 | 0 | 11 | stub |
| `balance-management` | 173 | 1 | 3 | partial |
| `bonus-rotator` | 81 | 0 | 0 | partial |
| `bonus-vault` | 172 | 0 | 0 | partial |
| `bounty-escrow` | 232 | 0 | 0 | partial |
| `campaign-claims` | 365 | 0 | 0 | partial |
| `challenge-ladder` | 83 | 0 | 0 | partial |
| `clan-seasons` | 179 | 0 | 0 | partial |
| `coin-flip` | 540 | 0 | 0 | partial |
| `color-prediction` | 758 | 2 | 16 | partial |
| `combo-rewards` | 147 | 0 | 0 | partial |
| `contract-address-registry` | 1088 | 0 | 26 | stub |
| `contract-circuit-breaker` | 298 | 0 | 3 | stub |
| `contract-health-registry` | 453 | 0 | 8 | implemented |
| `contract-interaction-library` | 554 | 0 | 15 | implemented |
| `contract-metadata-registry` | 449 | 0 | 9 | implemented |
| `contract-monitoring` | 483 | 0 | 9 | implemented |
| `contract-role-registry` | 126 | 0 | 0 | partial |
| `contract-upgrade-timelock` | 432 | 0 | 9 | implemented |
| `creator-drops` | 226 | 0 | 0 | partial |
| `creator-escrow` | 311 | 0 | 0 | partial |
| `creator-royalties` | 296 | 0 | 0 | stub |
| `creator-vaults` | 145 | 0 | 0 | partial |
| `cross-chain-bridge` | 749 | 0 | 10 | implemented |
| `cross-contract-call-guard` | 439 | 0 | 5 | implemented |
| `cross-contract-handler` | 353 | 0 | 0 | partial |
| `daily-challenges` | 315 | 0 | 0 | partial |
| `daily-reward-emission` | 349 | 0 | 3 | implemented |
| `daily-trivia` | 894 | 0 | 9 | implemented |
| `dice-roll` | 417 | 0 | 0 | partial |
| `duel-engine` | 87 | 0 | 0 | partial |
| `dynamic-fee-policy` | 566 | 0 | 9 | implemented |
| `emergency-pause` | 244 | 0 | 0 | partial |
| `epoch-scheduler` | 471 | 0 | 6 | stub |
| `escrow-ledger` | 179 | 0 | 3 | implemented |
| `escrow-marketplace` | 182 | 0 | 0 | partial |
| `escrow-vault` | 405 | 0 | 5 | implemented |
| `exploit-prevention` | 1027 | 0 | 36 | implemented |
| `fanout-distributor` | 410 | 0 | 5 | implemented |
| `fee-allocator` | 172 | 0 | 0 | stub |
| `fee-management` | 569 | 0 | 0 | partial |
| `fee-shield` | 253 | 0 | 0 | partial |
| `governance` | 724 | 0 | 0 | stub |
| `governance-token` | 534 | 0 | 12 | implemented |
| `grant-ledger` | 122 | 0 | 0 | partial |
| `guild-progress` | 239 | 0 | 0 | partial |
| `guild-season` | 88 | 0 | 0 | partial |
| `higher-lower` | 396 | 0 | 0 | partial |
| `identity-registry` | 179 | 0 | 0 | partial |
| `jackpot-pool` | 298 | 0 | 0 | partial |
| `ladder-checkpoints` | 291 | 0 | 0 | partial |
| `ladder-payouts` | 54 | 0 | 0 | stub |
| `ladder-seasons` | 179 | 0 | 0 | partial |
| `leaderboard` | 411 | 0 | 0 | stub |
| `lending-pool` | 123 | 0 | 0 | partial |
| `lobby-escrow` | 304 | 0 | 0 | partial |
| `lobby-gates` | 132 | 0 | 0 | partial |
| `loot-crate` | 150 | 0 | 0 | partial |
| `loot-rotation` | 115 | 0 | 0 | stub |
| `map-rotation` | 64 | 0 | 0 | stub |
| `map-voting` | 191 | 0 | 0 | partial |
| `matchmaking-queue` | 326 | 0 | 0 | partial |
| `merch-redemption` | 131 | 0 | 0 | partial |
| `mission-checkins` | 128 | 0 | 0 | partial |
| `mission-ledger` | 415 | 0 | 7 | implemented |
| `mission-pass` | 185 | 0 | 0 | partial |
| `multiplayer-room` | 656 | 0 | 11 | implemented |
| `nft-reward` | 403 | 0 | 8 | implemented |
| `number-guess` | 531 | 1 | 0 | partial |
| `oracle-integration` | 394 | 0 | 0 | partial |
| `pattern-puzzle` | 1022 | 4 | 13 | partial |
| `payout-checkpoints` | 54 | 0 | 0 | stub |
| `penalty-slashing` | 577 | 0 | 6 | implemented |
| `perk-claims` | 133 | 0 | 0 | partial |
| `player-rating` | 66 | 0 | 0 | stub |
| `player-stamps` | 240 | 0 | 0 | partial |
| `price-prediction` | 819 | 0 | 0 | partial |
| `prize-pool` | 719 | 0 | 0 | partial |
| `prize-router-v2` | 264 | 0 | 0 | partial |
| `prize-streamer` | 263 | 0 | 0 | partial |
| `profile-perks` | 146 | 0 | 0 | partial |
| `quest-ledger-v2` | 401 | 0 | 4 | implemented |
| `quest-redeemer` | 169 | 0 | 0 | stub |
| `queue-rewards` | 169 | 0 | 0 | stub |
| `raffle-engine` | 154 | 0 | 0 | partial |
| `raffle-escrow` | 17 | 0 | 0 | stub |
| `random-generator` | 1456 | 0 | 32 | implemented |
| `rank-rewards` | 265 | 0 | 0 | partial |
| `referral-quests` | 249 | 0 | 0 | partial |
| `referral-rewards` | 150 | 0 | 0 | partial |
| `referral-system` | 1009 | 0 | 27 | stub |
| `reserve-auction` | 309 | 0 | 0 | partial |
| `reserve-manager` | 134 | 0 | 0 | partial |
| `revenue-split` | 689 | 0 | 7 | implemented |
| `reward-distribution` | 690 | 0 | 21 | stub |
| `reward-router` | 94 | 0 | 0 | partial |
| `reward-stream` | 249 | 0 | 0 | partial |
| `reward-unlocker` | 249 | 0 | 0 | stub |
| `reward-vesting` | 647 | 0 | 19 | implemented |
| `round-finalizer` | 266 | 0 | 0 | stub |
| `round-vouchers` | 207 | 0 | 0 | partial |
| `season-rewards-vault` | 721 | 0 | 8 | stub |
| `session-nonce-manager` | 529 | 0 | 14 | implemented |
| `settlement-queue` | 640 | 0 | 0 | stub |
| `speed-trivia` | 890 | 0 | 8 | implemented |
| `sponsor-lockbox` | 230 | 0 | 0 | partial |
| `sponsor-payouts` | 17 | 0 | 0 | stub |
| `sponsor-pool` | 418 | 0 | 6 | implemented |
| `sponsorship-ledger` | 85 | 0 | 0 | stub |
| `squad-match` | 112 | 0 | 0 | partial |
| `squad-roster` | 374 | 0 | 0 | partial |
| `staking` | 753 | 0 | 10 | implemented |
| `staking-rewards` | 455 | 0 | 0 | partial |
| `streak-bonus` | 497 | 0 | 0 | partial |
| `streak-ladder` | 315 | 0 | 0 | partial |
| `team-prizes` | 299 | 0 | 0 | partial |
| `ticket-market` | 297 | 0 | 0 | partial |
| `ticket-redeemer` | 291 | 0 | 0 | partial |
| `tournament-lobby` | 135 | 0 | 0 | partial |
| `tournament-system` | 906 | 0 | 19 | implemented |
| `treasury` | 709 | 0 | 13 | implemented |
| `treasury-allocation` | 632 | 0 | 14 | implemented |
| `treasury-safeguard` | 119 | 0 | 0 | partial |
| `treasury-streams` | 17 | 0 | 0 | stub |
| `trivia-game` | 430 | 2 | 3 | partial |
| `upgrade-mechanism` | 735 | 0 | 8 | implemented |
| `vault-claims` | 470 | 0 | 7 | implemented |
| `vault-routing` | 169 | 0 | 0 | partial |
| `vip-subscription` | 1089 | 0 | 24 | implemented |
| `vote-escrow` | 195 | 0 | 3 | implemented |
| `voucher-minter` | 228 | 0 | 0 | partial |
| `wallet-claims-v2` | 217 | 0 | 0 | partial |
| `wallet-reserves` | 356 | 0 | 8 | implemented |
| `wordle-clone` | 1214 | 0 | 22 | implemented |
