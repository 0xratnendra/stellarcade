# Decaying Dutch Auction

An experimental Soroban contract for auctioning limited-edition arcade
cosmetic items where the price decays continuously (linearly) from a
starting price down to a reserve floor over a fixed duration. Anyone can
buy at the exact current decaying price; if no one buys, the seller can
cancel.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Creation** — `create_auction` records the item, `start_price`,
  `reserve_price`, and `duration` (seconds), starting the clock at the
  current ledger timestamp.
- **Pricing** — `get_current_price` linearly interpolates between
  `start_price` (at creation) and `reserve_price` (once `duration` has
  fully elapsed), and is floored at `reserve_price` forever after —
  price never drops below the reserve.
- **Buying** — `buy(buyer, auction_id, max_price)` purchases at the exact
  current decaying price, rejecting if that price exceeds the caller's
  `max_price` slippage guard, transfers the price from buyer to seller,
  and closes the auction.
- **Cancellation** — `cancel_auction` (seller-only) closes an auction
  that hasn't been bought yet, at any time.

## Storage layout

- `instance()`: `Token`, `AuctionCount` — small, fixed-size configuration.
- `persistent()`: `Auction(id)` — one entry per auction, bumped on every
  write.

## Interface

```rust
fn initialize(env: Env, token: Address);
fn create_auction(env: Env, seller: Address, item_id: Symbol, start_price: i128, reserve_price: i128, duration: u64) -> Result<u64, Error>;
fn get_current_price(env: Env, auction_id: u64) -> Result<i128, Error>;
fn buy(env: Env, buyer: Address, auction_id: u64, max_price: i128) -> Result<i128, Error>;
fn cancel_auction(env: Env, seller: Address, auction_id: u64) -> Result<(), Error>;
fn get_auction(env: Env, auction_id: u64) -> Result<Auction, Error>;
```

`create_auction` and `buy` enforce `require_auth()` on the caller they
act on behalf of; `cancel_auction` requires the caller to match the
auction's `seller`.

### Errors

`NotFound`, `InvalidInput`, `AuctionClosed`, `PriceExceedsMax`,
`NotSeller`.

## Usage (pseudo-flow)

```text
initialize(token)
id = create_auction(seller, "skin_1", start_price=1_000, reserve_price=200, duration=1_000)

// at t = 0:   get_current_price(id) == 1_000
// at t = 500: get_current_price(id) == 600
// at t = 1000+: get_current_price(id) == 200 (floored at reserve)

buy(buyer, id, max_price=600)   // succeeds if current price <= 600
// or, if no one buys:
cancel_auction(seller, id)
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/decaying-dutch-auction/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/decaying-dutch-auction/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
