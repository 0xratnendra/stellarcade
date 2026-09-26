# Sealed-Bid Duel Escrow

Experimental Soroban contract for 1v1 high-roller matches with hidden wagers:
commit-reveal over `SHA256(wager_be_bytes || salt)`, second-price settlement,
and timeout forfeit.

## Flow

1. `create_duel` — creator escrows a stake and posts their commitment.
2. `join_duel` — opponent matches the stake with their commitment; the reveal
   window (`REVEAL_WINDOW_LEDGERS`, ~1h) starts.
3. `reveal_bid` — each player (auth required) reveals wager + salt inside the
   window; mismatches are rejected with `CommitmentMismatch`.
4. `finalize_duel` — settle:

| Reveals at deadline        | Outcome                                                        |
| -------------------------- | -------------------------------------------------------------- |
| both                       | highest bid wins; loser refunds `min(win − second, stake)`      |
| only creator               | opponent forfeits: creator takes the pot                        |
| only opponent              | creator forfeits: opponent takes the pot                        |
| neither                    | both stakes refunded                                            |

## Methods

- `initialize(env, admin, token)`
- `create_duel(env, creator, commitment, stake) -> u64`
- `join_duel(env, opponent, duel_id, commitment, stake)`
- `reveal_bid(env, player, duel_id, wager, salt)`
- `finalize_duel(env, duel_id)`
- `get_duel(env, duel_id) -> SealedDuel`

## Tests

```bash
cargo test
```

Covers: full commit-reveal with second-price payout math, forfeit on missed
reveal, salt/amount mismatch rejection, outsider and double-reveal guards,
stake validation, tie handling, and early-finalize rejection.
