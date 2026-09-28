# House Bankroll LP

Experimental Soroban contract letting community members supply house
bankroll liquidity to whitelisted arcade games in return for a pro-rata
share of game yield.

## Flow

1. `initialize` — bootstrap admin and the bankroll token (one-time).
2. `set_game_authorized` — admin whitelists (or revokes) a game contract's
   ability to record profit/loss against the vault.
3. `deposit_liquidity` — LP deposits tokens, minting shares pro-rata to the
   vault's current equity (`amount * total_shares / total_equity`, or 1:1
   into an empty vault).
4. `record_game_pnl` — a whitelisted game reports profit or loss. Profits
   have a 10% performance fee skimmed to `get_admin_fees` before the
   remainder is credited to LP share value; losses are deducted in full.
   This call is accounting-only — it does not move tokens itself.
5. `request_withdraw` — burns shares and locks in their current equity
   value; starts a 24h lockup (`WITHDRAW_LOCKUP_LEDGERS`) before the
   provider can pull the underlying tokens back out. This lockup exists to
   stop an LP from front-running an in-flight bet by yanking liquidity out
   mid-round.
6. `claim_withdraw` — after the lockup elapses, transfers the locked-in
   amount back to the provider.

## Queries

- `get_share_price` — current share price, fixed-point scaled by 1e7.
- `get_total_tvl` — total accounting equity backing outstanding shares.
- `get_shares` — a provider's current share balance.
- `get_admin_fees` — accrued performance fees (bookkeeping only in this
  experimental contract; there is no separate fee-sweep transfer).

## Tests

```bash
cargo test
```
