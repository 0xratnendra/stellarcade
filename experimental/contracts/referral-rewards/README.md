# Referral Rewards

An experimental Soroban contract implementing on-chain player referral
tracking with a tiered rebate escrow. A player permanently binds a
referrer once; authorized game contracts report wager fee volume for that
player, and a share of it (scaling with the referrer's total active
referral count) accrues to the referrer as a claimable rebate.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Binding** — `register_referrer` permanently binds a player to a
  referrer. One-time only: a player who already has a bound referrer
  cannot rebind, even to the same referrer. Rejects self-referral
  (`player == referrer`) and the one circular shape possible under a
  strictly one-referrer-per-player model: player A referring player B,
  where B is already A's own referrer (A -> B -> A).
- **Authorized reporting** — `record_wager_fee` may only be called by a
  contract the admin has explicitly authorized via `authorize_caller`.
  Without this allowlist, an arbitrary caller could fabricate fee volume
  for any player to inflate a referrer's earnings; the intended callers
  are the arcade's own game contracts.
- **Tiered rewards** — reporting a player's wager fee looks up that
  player's bound referrer's CURRENT active-referral count and applies the
  highest reward tier that count qualifies for (e.g. 5% base, 10% at 5+
  referrals, 15% at 20+). Tiers must start at `min_referrals == 0` (every
  referrer earns at least the base tier) and are configured once at
  `initialize`.
- **Claiming** — `claim_referral_earnings` withdraws a referrer's full
  accumulated claimable balance in one call.

## Storage layout

- `instance()`: `Admin`, `Token`, `Tiers`, `AuthorizedCallers` — small,
  fixed-size configuration.
- `persistent()`: `Referrer(player)`, `ReferralCount(referrer)`, and
  `Claimable(referrer)` — bumped on every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address, tiers: Vec<RewardTier>) -> Result<(), Error>;
fn authorize_caller(env: Env, admin: Address, caller_contract: Address) -> Result<(), Error>;
fn register_referrer(env: Env, player: Address, referrer: Address) -> Result<(), Error>;
fn record_wager_fee(env: Env, caller_contract: Address, player: Address, fee_amount: i128) -> Result<i128, Error>;
fn claim_referral_earnings(env: Env, referrer: Address) -> Result<i128, Error>;
fn get_referrer_of(env: Env, player: Address) -> Option<Address>;
fn get_referral_count(env: Env, referrer: Address) -> u32;
fn get_claimable(env: Env, referrer: Address) -> i128;
```

`initialize`, `authorize_caller`, `register_referrer`,
`record_wager_fee`, and `claim_referral_earnings` all enforce
`require_auth()` on the caller they act on behalf of; `authorize_caller`
additionally requires the caller to match the configured `Admin`, and
`record_wager_fee` requires the caller to be on the authorized-caller
allowlist.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`,
`SelfReferralNotAllowed`, `CircularReferralNotAllowed`,
`ReferrerAlreadySet`, `NoReferrer`, `NotAuthorizedCaller`,
`NothingToClaim`, `InvalidTiers`.

## Usage (pseudo-flow)

```text
initialize(admin, token, [
  {min_referrals: 0, reward_bps: 500},    // 5% base
  {min_referrals: 5, reward_bps: 1_000},  // 10% at 5+ referrals
])
authorize_caller(admin, coinflip_duel_contract)

register_referrer(player, referrer)       // one-time, immutable
// ... player wagers on the game ...
record_wager_fee(coinflip_duel_contract, player, fee_amount=100)  // accrues 5 to referrer's claimable balance
claim_referral_earnings(referrer)         // withdraws the accrued 5
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/referral-rewards/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/referral-rewards/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
