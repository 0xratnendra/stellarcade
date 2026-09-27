# Lottery Pot

An experimental Soroban contract implementing an epoch-based pooled
lottery. Players buy tickets at a fixed price during a ledger-bounded
epoch; once the deadline passes, the admin draws a winner using a
commit-reveal random seed; the winner claims 90% of the pot, and the
remaining 10% rolls over into the next epoch. If a draw never happens,
players can reclaim their ticket cost after a grace period.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Epochs** — `start_lottery` opens a new epoch with a `ticket_price` and
  a `duration` in ledgers. Only one epoch is "current" at a time.
- **Ticket purchase** — `buy_tickets` charges `ticket_price * ticket_count`
  and assigns the player a contiguous range of sequential ticket ids
  starting at the epoch's current `tickets_sold`. Locked once the epoch's
  `draw_deadline_ledger` has passed.
- **Provably fair draw** — every ticket purchase happens on-chain *before*
  any random seed is known, which is the "commit" half of commit-reveal:
  the full set of ticket ranges (and therefore every possible outcome) is
  fixed and publicly visible before the draw. `draw_winner`'s "reveal" half
  combines the caller-supplied `random_seed` with the epoch id via
  `sha256(random_seed || epoch_id_be) % tickets_sold`, matching this
  workspace's `wheel-of-fortune` contract's commit-reveal derivation (see
  `experimental/contracts/wheel-of-fortune/src/lib.rs`'s
  `derive_segment_index`). Because ticket sales are already closed and
  immutable by the time `random_seed` is revealed, the only trust
  assumption is that the revealer didn't have foreknowledge of the seed
  before sales closed — the same assumption `wheel-of-fortune`'s
  server-secret reveal makes.
- **Zero-ticket epochs** — if nobody bought a ticket, `draw_winner` simply
  marks the epoch drawn with no winner and leaves its pot untouched for
  the next `start_lottery` call to roll forward.
- **Claiming** — `claim_jackpot` pays 90% of the pot to the address holding
  the drawn winning ticket and reduces the epoch's stored `pot` down to the
  remaining 10%, ready to roll into the next epoch.
- **Rollover guard** — `start_lottery` refuses to open a new epoch if the
  previous one was drawn, sold tickets, and its jackpot hasn't been
  claimed yet (`Error::PreviousJackpotUnclaimed`). Without this guard, the
  unclaimed 90% winner share sitting in the old epoch's `pot` would get
  silently folded into the new epoch's starting pot, and the original
  winner would have no way to claim it (`claim_jackpot` only ever looks at
  the *current* epoch).
- **Emergency refund** — if `draw_winner` is never called (e.g. the admin
  key is lost), `emergency_refund` lets each player reclaim their own
  ticket cost once `draw_deadline_ledger + EMERGENCY_REFUND_GRACE_LEDGERS`
  has passed with no draw.

## Storage layout

- `instance()`: `Admin`, `Token`, `EpochId` — small, fixed-size
  configuration.
- `persistent()`: `Epoch(id)`, `PlayerTickets(epoch_id, player)`,
  `TicketRanges(epoch_id)`, `Refunded(epoch_id, player)` — each bumped on
  every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error>;
fn start_lottery(env: Env, admin: Address, ticket_price: i128, duration: u32) -> Result<u64, Error>;
fn buy_tickets(env: Env, player: Address, ticket_count: u64) -> Result<u64, Error>;
fn draw_winner(env: Env, admin: Address, random_seed: BytesN<32>) -> Result<Option<Address>, Error>;
fn claim_jackpot(env: Env, winner: Address) -> Result<i128, Error>;
fn emergency_refund(env: Env, player: Address) -> Result<i128, Error>;
fn get_current_epoch(env: Env) -> Result<Epoch, Error>;
fn get_player_ticket_count(env: Env, player: Address) -> u64;
```

All mutating calls enforce `require_auth()` on the caller they act on
behalf of; `start_lottery` and `draw_winner` additionally require the
caller to match the configured `Admin`.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`,
`TicketSalesClosed`, `DrawNotYetAllowed`, `AlreadyDrawn`, `NotYetDrawn`,
`NoTicketsSold`, `NotTheWinner`, `AlreadyClaimed`, `RefundNotAvailable`,
`NothingToRefund`, `AlreadyRefunded`, `PreviousJackpotUnclaimed`.

## Usage (pseudo-flow)

```text
initialize(admin, token)
start_lottery(admin, ticket_price=5 XLM, duration=100)
buy_tickets(player_a, 3)   // tickets 0, 1, 2
buy_tickets(player_b, 2)   // tickets 3, 4
// wait 100 ledgers for sales to close

winner = draw_winner(admin, random_seed)   // e.g. resolves to player_a
claim_jackpot(winner)                       // pays 90% of the pot to player_a

start_lottery(admin, ticket_price=5 XLM, duration=100)   // carries the 10% rollover
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/lottery-pot/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/lottery-pot/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
