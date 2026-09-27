# Milestone Escrow

An experimental Soroban contract implementing a progressive player
milestone reward vault. Sponsors deposit a shared prize pool; the admin
configures a reward amount per milestone id (e.g. "10 wins" -> 10 XLM, "50
wins" -> 50 XLM, "100 wins" -> 150 XLM); an authorized oracle attests that a
specific player has completed a specific milestone; and the player then
claims the configured reward exactly once per milestone.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Configuration** — the admin sets the oracle address and the SEP-41
  token used for the prize pool at `initialize`, then configures a reward
  amount per milestone id via `configure_milestone`.
- **Pool deposits** — any address can sponsor the prize pool via
  `deposit_pool`.
- **Oracle verification** — only the configured oracle may call
  `verify_milestone` to attest that `(player, milestone_id)` is complete.
  Verifying an already-verified pair is idempotent (a no-op, not an error),
  since an oracle re-submitting the same attestation isn't a failure.
- **Claiming** — `claim_reward` requires the milestone to have been
  verified first, pays out the configured reward from the pool, and marks
  the `(player, milestone_id)` pair as claimed to prevent double-spending.
  A claim fails with `InsufficientPool` rather than partially paying out if
  the pool can't cover the configured reward.

## Storage layout

- `instance()`: `Admin`, `Oracle`, `Token`, `Pool`, `MilestoneReward(id)`
  per configured milestone — small, fixed-size configuration.
- `persistent()`: `Verified(player, milestone_id)` and
  `Claimed(player, milestone_id)` — one entry per player/milestone pair,
  bumped on every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, oracle: Address, token: Address) -> Result<(), Error>;
fn configure_milestone(env: Env, admin: Address, milestone_id: u64, reward: i128) -> Result<(), Error>;
fn deposit_pool(env: Env, sponsor: Address, amount: i128) -> Result<(), Error>;
fn verify_milestone(env: Env, oracle: Address, player: Address, milestone_id: u64) -> Result<(), Error>;
fn claim_reward(env: Env, player: Address, milestone_id: u64) -> Result<i128, Error>;
fn get_pool_balance(env: Env) -> i128;
fn is_milestone_verified(env: Env, player: Address, milestone_id: u64) -> bool;
fn is_milestone_claimed(env: Env, player: Address, milestone_id: u64) -> bool;
```

All mutating calls enforce `require_auth()` on the caller they act on
behalf of; `configure_milestone` additionally requires the caller to match
the configured `Admin`, and `verify_milestone` requires the caller to
match the configured `Oracle`.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`, `NotOracle`,
`MilestoneNotConfigured`, `MilestoneNotVerified`, `AlreadyClaimed`,
`InsufficientPool`.

## Usage (pseudo-flow)

```text
initialize(admin, oracle, token)
configure_milestone(admin, milestone_id=10, reward=10 XLM)
deposit_pool(sponsor, 1_000 XLM)

// off-chain: oracle observes the player reached 10 wins
verify_milestone(oracle, player, milestone_id=10)
claim_reward(player, milestone_id=10)   // pays 10 XLM, marks claimed
claim_reward(player, milestone_id=10)   // fails: AlreadyClaimed
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/milestone-escrow/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/milestone-escrow/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
