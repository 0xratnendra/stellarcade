# Plinko Multiplier

An experimental Soroban contract implementing a pegboard drop game. A
ball falls through a configurable number of rows of pegs, bouncing left
or right at each row via a deterministically-derived path, and lands in
one of `rows + 1` bins at the bottom, each paying a fixed multiplier of
the wager.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Provable fairness** — the ball's bounce path is derived from
  `sha256(client_seed || drop_id_be)`, matching this workspace's
  `wheel-of-fortune` contract's commit-reveal derivation pattern. There is
  no separate server-secret reveal phase (unlike `wheel-of-fortune`): a
  plinko drop resolves fully within one transaction, so the wager itself,
  submitted alongside `client_seed` in the same call, is the commitment —
  there is nothing left to commit to beforehand.
- **Path derivation** — each of the low `rows` bits of the digest
  determines one row's bounce (0 = left, 1 = right); the final bin index
  is the count of "right" bounces, a standard binomial/Galton-board path
  model.
- **Multiplier table** — bins are indexed `0..=rows` with the center at
  `rows / 2`. A bin's multiplier is linearly interpolated between the
  center multiplier (below 1x, since center bins are by far the most
  likely outcome under a binomial distribution) and the edge multiplier
  (the highest payout, scaling up with row count since edge outcomes get
  exponentially rarer on a larger board), by that bin's distance from
  center. Supported row counts: 8 (10x edge / 0.5x center), 12 (25x /
  0.3x), 16 (50x / 0.2x).
- **Bankroll protection** — `drop_ball` rejects a wager outright, before
  any funds move, if the WORST-CASE payout (wager × the edge multiplier)
  would exceed the house bankroll. This is a conservative check: it
  rejects some wagers that would have landed in a lower-paying bin and
  been perfectly affordable, in exchange for a simple, cheap pre-check
  that can never leave the bankroll unable to cover an outcome it already
  committed to.

## Storage layout

- `instance()`: `Admin`, `Token`, `Bankroll`, `DropCount` — small,
  fixed-size configuration.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address, house_bankroll: i128) -> Result<(), Error>;
fn drop_ball(env: Env, player: Address, wager: i128, client_seed: BytesN<32>, rows: u32) -> Result<DropResult, Error>;
fn get_bin_multipliers(env: Env, rows: u32) -> Result<Vec<u32>, Error>;
fn fund_bankroll(env: Env, admin: Address, amount: i128) -> Result<(), Error>;
fn sweep_bankroll(env: Env, admin: Address, amount: i128) -> Result<(), Error>;
fn get_bankroll(env: Env) -> i128;
```

`initialize`, `drop_ball`, `fund_bankroll`, and `sweep_bankroll` all
enforce `require_auth()` on the caller they act on behalf of;
`fund_bankroll` and `sweep_bankroll` additionally require the caller to
match the configured `Admin`.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`,
`UnsupportedRowCount`, `InvalidBinIndex`, `WagerExceedsBankrollLimit`.

## Usage (pseudo-flow)

```text
initialize(admin, token, house_bankroll=100_000 XLM)
drop_ball(player, wager=100 XLM, client_seed, rows=8)
// -> resolves to a bin (e.g. edge bin 0 or 8: pays 10x = 1_000 XLM;
//    center bin 4: pays 0.5x = 50 XLM)
get_bin_multipliers(rows=8)  // [1000, 762, 525, 287, 50, 287, 525, 762, 1000]
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/plinko-multiplier/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/plinko-multiplier/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
