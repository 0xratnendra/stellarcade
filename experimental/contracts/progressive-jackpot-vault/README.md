# Progressive Jackpot Vault

A Soroban multi-game progressive jackpot pooling vault: whitelisted game contracts feed
micro-contributions into a shared pot, and a tiered claim pays out a percentage of it to a
winner.

## Methods

| Method | Description |
|---|---|
| `initialize(env, admin, token, seed_amount)` | One-time setup; seeds the pot to `seed_amount`. |
| `add_game(env, admin, game_address)` | Admin-only. Whitelists a game contract to contribute/claim. |
| `contribute(env, game_address, amount)` | Whitelisted-game-only. Adds `amount` to the pot. |
| `claim_jackpot(env, game_address, winner, tier)` | Whitelisted-game-only. Pays a tier's share of the pot to `winner`. |
| `get_pot` / `is_game_whitelisted` / `get_config` | Read helpers. |

## Jackpot tiers

| Tier | Payout |
|---|---|
| Mini | 10% of the pot |
| Major | 50% of the pot |
| Mega | 100% of the pot, then the reserve re-seeds to `seed_amount` |

## Invariants enforced

- `add_game` requires admin `.require_auth()`.
- `contribute` and `claim_jackpot` require the calling game contract's own `.require_auth()`, and
  are rejected outright for a non-whitelisted address.
- `claim_jackpot` is rejected on an empty pot (`Error::EmptyPot`), so a Mini/Major claim can never
  drain the pot below zero and a Mega claim on an already-empty pot cannot succeed either.

## Testing

```bash
cargo test -p progressive-jackpot-vault
```

Covers: registered games depositing contributions (single and accumulated across multiple
calls), unauthorized (non-whitelisted) contract rejection on `contribute`, each tier's payout
percentage and token transfer, the Mega tier's reserve re-seed, admin-only game registration
(including rejecting a duplicate registration), and the empty-pot claim rejection.
