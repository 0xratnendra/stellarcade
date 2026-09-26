# Jackpot Drip Pool

Experimental Soroban contract distributing periodic jackpot drops to active
arcade players: a reserve funded by game fees drips a fixed rate per ledger and
players claim a time-weighted share proportional to their wager volume.

## Allocation model

- Pool: funded via `fund_drip_pool`; drips at `drip_rate_per_ledger` tokens.
- Weight: a player's recorded wager volume (`record_player_activity`).
- Claim: `rate × ledgers_since_last_claim × (player_volume / total_volume)`,
  always capped at the available pool balance. Zero activity → zero payout.

## Flow

1. `initialize(env, admin, token, drip_rate_per_ledger)`.
2. `fund_drip_pool` — fees flow into the reserve.
3. `record_player_activity` — wagers grow a player's weight.
4. `claim_drip` — player (auth required) collects their accrued share.
5. Emergency sweep — admin-only, two-step with a `SWEEP_TIMELOCK_LEDGERS`
   delay: `request_emergency_sweep` schedules it, `execute_emergency_sweep`
   drains the pool once the timelock elapses.

## Methods

- `initialize(env, admin, token, drip_rate_per_ledger)`
- `fund_drip_pool(env, funder, amount)`
- `record_player_activity(env, player, volume)`
- `claim_drip(env, player) -> i128`
- `get_pool_balance(env) -> i128`
- `get_drip_rate(env) -> i128`
- `get_player_activity(env, player) -> PlayerActivity`
- `total_weight(env) -> i128`
- `request_emergency_sweep(env, admin, recipient) -> u32`
- `execute_emergency_sweep(env, admin) -> i128`

## Tests

```bash
cargo test
```

Covers: pool funding, proportional claims over elapsed ledgers, weight
proportionality, zero-activity claims, pool-balance cap, emergency-sweep
timelock (block-then-execute) and its access controls, and input validation.
