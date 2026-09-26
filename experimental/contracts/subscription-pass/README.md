# Subscription Pass

An experimental Soroban contract implementing a recurring arcade season
subscription pass. Players prepay a fixed cost to activate or renew a
time-boxed membership window, and the admin can configure VIP tiers that
grant bonus duration on top of the base window.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Configuration** — the admin sets the SEP-41 token used for payment, the
  flat `pass_cost` charged per purchase/renewal, and the base
  `duration_ledgers` window granted per purchase/renewal.
- **Purchase** — `buy_pass` charges `pass_cost` and starts a brand-new
  membership window from the current ledger. If the player already holds a
  pass (active or expired), the new window replaces it rather than stacking
  on top of remaining time — use `renew_pass` to extend without losing
  unused time.
- **Renewal** — `renew_pass` charges `pass_cost` again and extends from the
  *later* of "now" and the pass's current expiry: renewing early preserves
  remaining time, and renewing after expiry does not backdate the new
  window onto the stale one.
- **Active check** — `is_pass_active` is a strict `<` comparison against the
  current ledger sequence: a pass expiring exactly at the current ledger is
  no longer active.
- **VIP tiers** — the admin configures a bonus-ledger amount per tier id via
  `admin_configure_tier`, then assigns a player to that tier via
  `admin_set_tier`. The bonus applies on the player's next purchase or
  renewal (assigning a tier does not itself extend an already-active
  window). Tier `0` is the base tier and always grants zero bonus.

## Storage layout

- `instance()`: `Admin`, `Token`, `PassCost`, `DurationLedgers`, and
  `TierBonus(tier)` per configured VIP tier — small, fixed-size
  configuration.
- `persistent()`: `Pass(player)` — one entry per player, bumped on every
  write.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address, pass_cost: i128, duration_ledgers: u32) -> Result<(), Error>;
fn buy_pass(env: Env, player: Address) -> Result<PassRecord, Error>;
fn renew_pass(env: Env, player: Address) -> Result<PassRecord, Error>;
fn is_pass_active(env: Env, player: Address) -> bool;
fn get_pass_details(env: Env, player: Address) -> Result<PassRecord, Error>;
fn admin_set_tier(env: Env, admin: Address, player: Address, tier: u32) -> Result<(), Error>;
fn admin_configure_tier(env: Env, admin: Address, tier: u32, bonus_ledgers: u32) -> Result<(), Error>;
```

All mutating calls enforce `require_auth()` on the caller they act on
behalf of; `admin_set_tier` and `admin_configure_tier` additionally require
the caller to match the configured `Admin`.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`, `NoActivePass`,
`InvalidTier`.

## Usage (pseudo-flow)

```text
initialize(admin, token, pass_cost=100, duration_ledgers=1_000)
buy_pass(player)                       // active for 1_000 ledgers
is_pass_active(player)                 // true
// ... 1_000 ledgers pass ...
is_pass_active(player)                 // false
renew_pass(player)                     // active for another 1_000 ledgers from now

admin_configure_tier(admin, tier=1, bonus_ledgers=500)
admin_set_tier(admin, player, tier=1)
renew_pass(player)                     // active for 1_500 ledgers (base + tier bonus)
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/subscription-pass/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/subscription-pass/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
