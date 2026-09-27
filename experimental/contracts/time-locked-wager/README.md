# Time-Locked Wager

An experimental Soroban contract implementing a time-locked match
challenge and forfeit escrow. A challenger issues a challenge, locking
their wager and specifying a response deadline; an opponent accepts
before that deadline, locking a matching wager. If the opponent never
accepts, the challenger reclaims their wager with no fee once the
deadline passes. Once accepted, if a player goes unresponsive past the
match's own timeout, the other player can claim a forfeit victory,
subject to a dispute grace period before the payout finalizes.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **State machine**: `Pending` → (`accept_challenge`) → `Active` →
  (`claim_timeout_forfeit`) → `ForfeitClaimed` → (`dispute_forfeit`) →
  back to `Active`, or (`finalize_forfeit`, undisputed) → `Resolved`.
  `Pending` → (`cancel_expired_challenge`, opponent no-show) →
  `Cancelled`.
- **Response deadline** — `create_challenge` locks the challenger's wager
  and sets `response_deadline_ledger`. `accept_challenge` must be called
  by the designated opponent before that deadline; `cancel_expired_challenge`
  lets the challenger reclaim their wager, with no fee, once it has
  passed unaccepted.
- **Match timeout and forfeit** — accepting a challenge locks a matching
  wager and sets `match_timeout_ledger`. Once the current ledger passes
  it, either participant may call `claim_timeout_forfeit` against the
  OTHER participant (whichever side calls it is the claimant; the other
  side is the accused).
- **Dispute grace period** — a forfeit claim does not pay out immediately.
  It starts a `DISPUTE_GRACE_LEDGERS` (~10 minutes) window during which
  the accused player may call `dispute_forfeit` to return the challenge to
  `Active` (undoing nothing else — the original claimant would need a
  fresh timeout to claim again). If undisputed, `finalize_forfeit` (once
  the grace period passes; callable by anyone) pays the full pot — both
  wagers — to the claimant.

## Storage layout

- `instance()`: a single challenge counter.
- `persistent()`: `Challenge(id)`, bumped on every write.

## A naming pitfall worth knowing

This repo's `soroban-sdk` version enforces a 30-character limit on
`#[contracttype]` struct field names. Exceeding it surfaces as a
confusing cascading `TryFromVal`/`IntoVal` trait-bound error on the whole
struct, not a clear "field name too long" message — encountered directly
while building this contract (`forfeit_dispute_deadline_ledger`, 31
characters, tripped it; renamed to `forfeit_dispute_deadline`). Worth
checking field name length first if a `#[contracttype]` struct suddenly
fails to compile with an opaque trait-bound error under `cargo test`
specifically.

## Interface

```rust
fn create_challenge(env: Env, challenger: Address, opponent: Address, token: Address, wager: i128, timeout: u32) -> Result<u64, Error>;
fn accept_challenge(env: Env, opponent: Address, challenge_id: u64, match_timeout: u32) -> Result<(), Error>;
fn cancel_expired_challenge(env: Env, challenger: Address, challenge_id: u64) -> Result<i128, Error>;
fn claim_timeout_forfeit(env: Env, claimant: Address, challenge_id: u64) -> Result<(), Error>;
fn dispute_forfeit(env: Env, accused: Address, challenge_id: u64) -> Result<(), Error>;
fn finalize_forfeit(env: Env, challenge_id: u64) -> Result<i128, Error>;
fn get_challenge(env: Env, challenge_id: u64) -> Result<Challenge, Error>;
```

`create_challenge`, `accept_challenge`, `cancel_expired_challenge`,
`claim_timeout_forfeit`, and `dispute_forfeit` all enforce
`require_auth()` on the caller they act on behalf of. `finalize_forfeit`
is permissionless once the dispute deadline has passed — the dispute
window itself is the safeguard, not caller authorization.

### Errors

`NotFound`, `InvalidInput`, `ChallengeExpired`, `ChallengeNotExpired`,
`NotThePendingOpponent`, `WrongChallengeState`, `NotAParticipant`,
`TimeoutNotYetReached`, `DisputeWindowExpired`, `NotTheAccusedPlayer`.

## Usage (pseudo-flow)

```text
create_challenge(challenger, opponent, token, wager=100 XLM, timeout=100)
accept_challenge(opponent, id, match_timeout=200)
// ... opponent goes unresponsive mid-match ...
// wait match_timeout ledgers
claim_timeout_forfeit(challenger, id)
// wait DISPUTE_GRACE_LEDGERS ledgers (undisputed)
finalize_forfeit(id)  // pays 200 XLM (both wagers) to challenger

// or, if the opponent never accepts at all:
// wait response deadline
cancel_expired_challenge(challenger, id)  // reclaims 100 XLM, no fee
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/time-locked-wager/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/time-locked-wager/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
