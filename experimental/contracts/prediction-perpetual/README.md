# Prediction Perpetual

Experimental Soroban contract for pari-mutuel binary-outcome prediction markets,
for arcade tournament questions like "Will Player A defeat Player B?".

## Flow

1. `initialize` — bootstrap the admin and the escrow token (one-time).
2. `create_market` — the market's designated oracle creates a YES/NO market
   with a resolution deadline (`end_time`).
3. `place_bet` — stake tokens on YES or NO before `end_time`.
4. `resolve` — after `end_time` has passed, the designated oracle reports the
   winning side.
5. `claim` — winners withdraw their pro-rata share of the full pool
   (`stake_on_winning_side * total_pool / winning_pool`), i.e. their own
   stake back plus a proportional cut of the losing pool.

## Odds

`get_implied_odds` returns the current YES/NO split in basis points (out of
10,000), derived from the live pool balances. Returns `(5000, 5000)` before
any bets exist.

## Tests

```bash
cargo test
```
