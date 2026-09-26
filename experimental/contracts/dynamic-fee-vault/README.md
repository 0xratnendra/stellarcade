# Dynamic Fee Vault

Experimental Soroban vault contract that reduces the arcade rake for
high-volume VIP players using rolling 30-day wager volume.

## Fee tiers

| Tier   | Rolling 30d volume | Fee   |
| ------ | ------------------ | ----- |
| Base   | < 50,000           | 2.00% |
| Bronze | ≥ 50,000           | 1.50% |
| Silver | ≥ 500,000          | 1.00% |
| Gold   | ≥ 5,000,000        | 0.50% |

The effective fee never drops below the `MIN_FEE_BPS` floor (0.25%). Rolling
windows decay: once `WINDOW_LEDGERS` (~30 days) passes since the window start,
the player's volume resets and the tier is recomputed from new activity.

## Flow

1. `initialize` — admin registers the settlement token.
2. `record_volume` — game host records each wager (player auth required).
3. `get_fee_bps_for_player` — effective fee in basis points for the next wager.
4. `collect_fee` — host transfers the net house fee into the vault.
5. `withdraw_fees` — admin-only withdrawal of accumulated fees.

## Methods

- `initialize(env, admin, token)`
- `record_volume(env, player, amount)`
- `get_fee_bps_for_player(env, player) -> u32`
- `collect_fee(env, from, fee_amount)`
- `withdraw_fees(env, admin, recipient) -> i128`
- `get_player_volume(env, player) -> PlayerVolume`
- `get_fees_collected(env) -> i128`

## Tests

```bash
cargo test
```

Covers: tier upgrades from volume accumulation, lower fees for high-volume
players, window decay resets, fee floor, unauthorized withdrawal rejection,
admin withdrawal, empty-vault rejection, and input validation.
