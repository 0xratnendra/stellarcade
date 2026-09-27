# Dice Duel Escrow

An experimental Soroban contract implementing a peer-to-peer 1v1 dice
duel. A creator invites a specific opponent and locks a wager; the
opponent accepts, matching it; both players commit to a hidden dice roll,
then reveal it; the higher roll sweeps the pot, and an unresolved tie
splits it evenly.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Invitation** — `create_duel` locks the creator's wager and names a
  specific `opponent` address. Only that exact address may `accept_duel`
  — nobody else can hijack the invitation.
- **Cancellation** — `cancel_duel` (creator-only) refunds the creator's
  wager, with no fee, as long as the opponent hasn't joined yet.
- **Commit-reveal** — each player calls `commit_roll` with
  `sha256(secret || player_address)`, binding the commitment to the
  specific committing player's own address, not just the secret. This
  means the SECOND committer cannot copy the FIRST committer's on-chain
  commitment hash verbatim and later reveal the same secret to force a
  tie: their own commitment would need `their_own_address` baked in,
  which a copied hash wouldn't produce, so `roll_dice`'s hash check fails
  for the copier, not the honest original committer.
- **Reveal** — once both players have committed, either may call
  `roll_dice(player, duel_id, secret)`, which verifies the secret hashes
  back to that player's own stored commitment and derives their die value
  as `sha256(secret) % sides + 1`. Once both have revealed, the duel
  auto-resolves: the higher roll sweeps the full pot, or an equal roll
  moves the duel to `Tied`.
- **Tie handling** — a tie is resolved by `settle_duel` splitting the pot
  evenly, not a re-roll: re-rolling within the same duel id would need to
  reset both commitments for a fresh round, which is meaningfully more
  state-machine complexity for a rare edge case (rolling exactly equal is
  the least likely single outcome on a d6 or d20) that an even split
  already resolves fairly.

## Storage layout

- `instance()`: a single duel counter.
- `persistent()`: `Duel(id)`, bumped on every write.

## Interface

```rust
fn create_duel(env: Env, creator: Address, opponent: Address, token: Address, wager: i128, dice: DiceSides) -> Result<u64, Error>;
fn accept_duel(env: Env, opponent: Address, duel_id: u64) -> Result<(), Error>;
fn cancel_duel(env: Env, creator: Address, duel_id: u64) -> Result<i128, Error>;
fn commit_roll(env: Env, player: Address, duel_id: u64, commitment: BytesN<32>) -> Result<(), Error>;
fn roll_dice(env: Env, player: Address, duel_id: u64, secret: BytesN<32>) -> Result<u32, Error>;
fn settle_duel(env: Env, duel_id: u64) -> Result<i128, Error>;
fn get_duel(env: Env, duel_id: u64) -> Result<Duel, Error>;
```

`create_duel`, `accept_duel`, `cancel_duel`, `commit_roll`, and
`roll_dice` all enforce `require_auth()` on the caller they act on behalf
of. `settle_duel` is permissionless (callable by anyone once a duel is
tied) — there is nothing left to authorize once both rolls are already
revealed and equal.

### Errors

`NotFound`, `InvalidInput`, `NotThePendingOpponent`, `WrongDuelState`,
`NotAParticipant`, `AlreadyCommitted`, `NoCommitmentFound`,
`CommitmentMismatch`, `NotBothRevealed`.

## Usage (pseudo-flow)

```text
create_duel(creator, opponent, token, wager=50 XLM, dice=D6)
accept_duel(opponent, id)

commit_roll(creator, id, sha256(creator_secret || creator_address))
commit_roll(opponent, id, sha256(opponent_secret || opponent_address))

roll_dice(creator, id, creator_secret)    // e.g. rolls a 6
roll_dice(opponent, id, opponent_secret)  // e.g. rolls a 3
// -> auto-resolves: creator sweeps 100 XLM

// or, on a tie:
settle_duel(id)  // splits the pot 50/50
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/dice-duel-escrow/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/dice-duel-escrow/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
