# Bounty Escrow

An experimental Soroban contract implementing a community arcade bounty
and speedrun escrow. A sponsor posts a bounty (a prize pool tied to a
target game, tiered score thresholds, and a deadline); a player submits a
proof-of-achievement claim; a designated verifier approves the claim,
releasing the highest unlocked tier's payout; and the sponsor can reclaim
any unpaid remainder once the bounty expires.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Posting** — `post_bounty` deposits `amount` of the configured token
  and defines a tiered payout schedule (`tiers`): each tier has a
  `score_threshold` and a cumulative `payout_bps` share of the total
  bounty. Tiers must be sorted ascending by threshold, with non-decreasing
  cumulative `payout_bps`, and the top tier must pay out exactly 100%
  (`BPS_DENOMINATOR`).
- **Claiming** — `submit_claim` records a player's claimed score and an
  off-chain proof hash (e.g. a hash of a recorded game session) for the
  verifier to check before approving. A new submission overwrites any
  previous unapproved claim for that bounty.
- **Approval** — `approve_bounty` (verifier-only) pays out the highest
  tier the claimed score unlocks that hasn't already been paid, and pays
  only the **incremental** share between the previously paid tier and the
  newly unlocked one — so approving successive higher-scoring claims over
  time pays each tier's marginal share exactly once, never re-paying a
  tier or double-paying the full amount.
- **Expiration refund** — `refund_expired` (sponsor-only, after the
  deadline) returns only the unpaid remainder (`amount - paid_out`), never
  funds already sent to a player for an earlier approved tier. Once
  refunded, the bounty can no longer accept new claims or approvals.

## Storage layout

- `instance()`: `Token`, `BountyCount` — small, fixed-size configuration.
- `persistent()`: `Bounty(id)` and `Claim(id)` — one entry per bounty
  (each holding at most one outstanding claim at a time), bumped on every
  write.

## Interface

```rust
fn initialize(env: Env, token: Address);
fn post_bounty(env: Env, sponsor: Address, target_game: Symbol, amount: i128, deadline_ledger: u32, verifier: Address, tiers: Vec<BountyTier>) -> Result<u64, Error>;
fn submit_claim(env: Env, player: Address, bounty_id: u64, proof_hash: BytesN<32>, claimed_score: u32) -> Result<(), Error>;
fn approve_bounty(env: Env, verifier: Address, bounty_id: u64) -> Result<i128, Error>;
fn refund_expired(env: Env, sponsor: Address, bounty_id: u64) -> Result<i128, Error>;
fn get_bounty(env: Env, bounty_id: u64) -> Result<Bounty, Error>;
fn get_claim(env: Env, bounty_id: u64) -> Option<Claim>;
```

`post_bounty`, `submit_claim`, `approve_bounty`, and `refund_expired` all
enforce `require_auth()` on the caller they act on behalf of;
`approve_bounty` additionally requires the caller to match the bounty's
configured `verifier`, and `refund_expired` requires the caller to match
the bounty's `sponsor`.

### Errors

`NotFound`, `InvalidInput`, `InvalidTiers`, `NotAuthorizedVerifier`,
`BountyExpired`, `BountyNotExpired`, `AlreadyRefunded`, `NoClaimSubmitted`,
`ScoreBelowLowestTier`, `TierAlreadyPaid`, `ClaimNotFound`.

## Usage (pseudo-flow)

```text
initialize(token)
tiers = [ {score_threshold: 100, payout_bps: 5_000}, {score_threshold: 500, payout_bps: 10_000} ]
id = post_bounty(sponsor, "speedrun", amount=1_000 XLM, deadline, verifier, tiers)

submit_claim(player, id, proof_hash, claimed_score=150)
approve_bounty(verifier, id)          // pays out 50% (tier 0)

submit_claim(player, id, proof_hash2, claimed_score=500)
approve_bounty(verifier, id)          // pays out the remaining 50% (tier 1)

// or, if no claim is ever approved before the deadline:
refund_expired(sponsor, id)           // returns the full unpaid amount
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/bounty-escrow/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/bounty-escrow/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
