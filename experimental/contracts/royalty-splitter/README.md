# Royalty Splitter

An experimental Soroban contract implementing a tournament fee and creator
royalty splitter. Distributes tournament rake and arcade game fees among
developers, the house, and community pools according to configured
basis-point shares, and lets an admin adjust the split over time subject
to a timelock.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Initialization** — `initialize` sets a fixed recipient list and their
  basis-point shares (parallel arrays). Shares must sum to exactly
  `BPS_DENOMINATOR` (10,000 bps = 100%).
- **Distribution** — `distribute_revenue` pulls `total_amount` of a given
  token from the depositor and splits it proportionally. The caller
  chooses the distribution mode:
  - `push = true`: transfers each recipient's share directly, in the same
    call.
  - `push = false`: accumulates each recipient's share into a claimable
    balance for later withdrawal via `claim_shares`.

  Any basis-point rounding remainder (from flooring each recipient's
  proportional share) is added to the **last** recipient's share, so no
  dust from the split is ever silently lost or left stuck in the
  contract.
- **Claiming** — `claim_shares` withdraws a recipient's full accumulated
  claimable balance of a given token in one call.
- **Timelocked share updates** — `propose_share_update` (admin-only)
  stages a new recipient/share configuration; `execute_share_update`
  applies it once `SHARE_UPDATE_TIMELOCK_LEDGERS` (~24h) has elapsed since
  the proposal, giving recipients a window to notice a reallocation before
  it takes effect. Execution itself is permissionless once the delay has
  passed — the timelock is the safeguard, not caller authorization.

## Storage layout

- `instance()`: `Admin`, `Recipients`, `Shares`, `PendingUpdate` — small,
  fixed-size configuration.
- `persistent()`: `Claimable(recipient, token)` — one entry per
  recipient/token pair, bumped on every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, recipients: Vec<Address>, shares: Vec<u32>) -> Result<(), Error>;
fn distribute_revenue(env: Env, depositor: Address, token: Address, total_amount: i128, push: bool) -> Result<(), Error>;
fn claim_shares(env: Env, recipient: Address, token: Address) -> Result<i128, Error>;
fn propose_share_update(env: Env, admin: Address, recipients: Vec<Address>, shares: Vec<u32>) -> Result<u32, Error>;
fn execute_share_update(env: Env) -> Result<(), Error>;
fn get_recipients(env: Env) -> Vec<Address>;
fn get_shares(env: Env) -> Vec<u32>;
fn get_claimable(env: Env, recipient: Address, token: Address) -> i128;
```

`initialize`, `distribute_revenue`, `claim_shares`, and
`propose_share_update` all enforce `require_auth()` on the caller they act
on behalf of; `propose_share_update` additionally requires the caller to
match the configured `Admin`.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`,
`SharesMustSumToTenThousand`, `MismatchedRecipientsAndShares`,
`NoPendingUpdate`, `TimelockNotExpired`, `NothingToClaim`, `NotARecipient`.

## Usage (pseudo-flow)

```text
initialize(admin, [dev, house, community], [5_000, 3_000, 2_000])  // 50/30/20
distribute_revenue(depositor, token, 1_000 XLM, push=true)          // pays out immediately
distribute_revenue(depositor, token, 500 XLM, push=false)           // accrues claimable balances
claim_shares(community, token)                                       // community withdraws its share

propose_share_update(admin, [dev, house], [6_000, 4_000])
// wait SHARE_UPDATE_TIMELOCK_LEDGERS ledgers
execute_share_update()                                                // new 60/40 split takes effect
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/royalty-splitter/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/royalty-splitter/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
