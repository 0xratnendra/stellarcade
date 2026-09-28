# Coin Flip Verifiable

An experimental Soroban contract implementing an isolated 1v1 coin flip
escrow. Player 1 opens a game, calling a side (heads or tails) and
locking a wager alongside a commitment to a secret salt; player 2 joins,
matching the wager and committing their own secret salt. Once both
reveal, the outcome is derived from both salts together, so neither
player alone controls the result.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Open + join** — `create_game` locks player 1's wager and commitment,
  naming a side to call. Any second address may `join_game`, matching
  the wager and committing their own salt — the game is open, not
  addressed to a specific opponent (unlike a private duel invitation).
- **Commit-reveal** — each player commits
  `sha256(secret_salt || player_address)`, binding the commitment to the
  specific committing player's own address, not just the secret. This
  means one player cannot copy the other's on-chain commitment hash
  verbatim and later reveal the same secret: their own commitment would
  need `their_own_address` baked in, which a copied hash wouldn't
  produce, so `reveal_seed`'s hash check fails for the copier, not the
  honest original committer.
- **Outcome derivation** — once both salts are revealed, they're XORed
  byte-for-byte and the parity of the first byte decides the flip: even
  is `Heads`, odd is `Tails`. Since both salts are committed before
  either player sees the other's, neither can bias the outcome toward
  their own called side after the fact. Player 1 wins if the derived
  outcome matches their `choice`; player 2 is implicitly the opposite
  side.
- **Instant settlement** — the second reveal immediately settles the
  game: `pot - fee` goes to the winner, `fee` (in basis points, set at
  `initialize`) goes to the admin.
- **Timeout protection** — once both players have joined, a
  `reveal_deadline` (`REVEAL_WINDOW_SECONDS` out) is set. If one player
  reveals and the other stalls past the deadline, the honest revealer
  calls `claim_timeout` to sweep the full pot uncontested, with no house
  fee taken — it's a penalty against the non-revealing counterparty, not
  a normal resolution.

## Storage layout

- `instance()`: `Config` (admin, token, house fee in bps) and a game
  counter.
- `persistent()`: `Game(id)`, bumped on every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address, fee_bps: u32) -> Result<(), Error>;
fn create_game(env: Env, player: Address, wager: i128, commit_hash: BytesN<32>, choice: CoinSide) -> Result<u64, Error>;
fn join_game(env: Env, player: Address, game_id: u64, commit_hash: BytesN<32>) -> Result<(), Error>;
fn reveal_seed(env: Env, player: Address, game_id: u64, secret_salt: BytesN<32>) -> Result<(), Error>;
fn claim_timeout(env: Env, player: Address, game_id: u64) -> Result<i128, Error>;
fn get_game(env: Env, game_id: u64) -> Result<Game, Error>;
fn get_config(env: Env) -> Result<Config, Error>;
```

`initialize`, `create_game`, `join_game`, `reveal_seed`, and
`claim_timeout` all enforce `require_auth()` on the caller they act on
behalf of. `get_game` and `get_config` are read-only.

### Errors

`NotFound`, `InvalidInput`, `AlreadyInitialized`, `NotInitialized`,
`WrongGameState`, `NotAParticipant`, `CommitmentMismatch`,
`AlreadyRevealed`, `TimeoutNotReached`, `NoRevealYet`,
`CounterpartyAlreadyRevealed`.

## Usage (pseudo-flow)

```text
initialize(admin, token, fee_bps=250)  // 2.5% house fee

create_game(player1, wager=100 XLM, sha256(salt1 || player1), choice=Heads)
join_game(player2, id, sha256(salt2 || player2))

reveal_seed(player1, id, salt1)
reveal_seed(player2, id, salt2)
// -> auto-resolves: XOR(salt1, salt2) decides Heads/Tails,
//    winner receives 200 XLM minus the house fee

// or, if player2 never reveals before the deadline:
claim_timeout(player1, id)  // player1 sweeps the full 200 XLM, no fee
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/coin-flip-verifiable/Cargo.toml
```

Build for wasm (optional, requires the `wasm32v1-none` target — this
soroban-sdk version rejects the older `wasm32-unknown-unknown` target on
Rust 1.82+):

```bash
rustup target add wasm32v1-none
cargo build --manifest-path experimental/contracts/coin-flip-verifiable/Cargo.toml \
  --target wasm32v1-none --release
```
