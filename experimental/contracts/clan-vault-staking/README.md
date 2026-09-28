# Clan Vault Staking

A Soroban staking vault where gaming clans pool member token deposits to earn a proportional
share of treasury dividends. Members lock tokens into one of three tiers, each carrying a
dividend-weight multiplier.

## Lock tiers

| Duration | Multiplier |
|---|---|
| 30 days | 1.0x |
| 90 days | 1.2x |
| 180 days | 1.5x |

A longer commitment earns a proportionally larger slice of any given dividend distribution for
the same staked amount — it does not change how much principal is returned on `unstake`.

## Methods

| Method | Description |
|---|---|
| `initialize(env, token)` | One-time setup. |
| `create_clan(env, leader, clan_id)` | Registers a clan with `leader` as its designated leader. |
| `stake(env, member, clan_id, amount, duration)` | Locks `amount` for `duration` seconds (must match a tier exactly). |
| `distribute_dividends(env, leader, clan_id, reward_amount)` | Leader-only. Splits `reward_amount` across every active stake, proportional to dividend weight. |
| `claim_dividends(env, member, clan_id)` | Pays out a member's accumulated claimable balance. |
| `unstake(env, member, clan_id)` | Releases principal after the lock period expires. |
| `get_clan` / `get_stake` / `get_claimable` | Read helpers. |

## Dividend math

```
weight_i    = amount_i * multiplier_bps_i
total_weight = sum(weight_i) over every active stake
share_i     = reward_amount * weight_i / total_weight
```

Each distribution is settled eagerly, across every currently active stake, in the same
transaction — not lazily deferred — so there is no cross-distribution accumulator to keep
consistent as the staker set changes. Iteration is bounded by `MAX_CLAN_MEMBERS` (200).

## Invariants enforced

- A clan id can only be registered once.
- A member may hold only one active stake per clan at a time.
- `unstake` is rejected before the stake's lock period expires.
- Only the clan's registered leader may call `distribute_dividends`.

## Testing

```bash
cargo test -p clan-vault-staking
```

Covers: staking recording the correct amount/multiplier/weight, rejecting an invalid lock
duration, dividend distribution splitting proportionally across mixed-tier stakers (verified
against a hand-computed expected split), leader-only distribution enforcement, claiming resetting
the claimable balance and paying out the real token balance, and both the early-unstake rejection
and the successful post-lock unstake path.
