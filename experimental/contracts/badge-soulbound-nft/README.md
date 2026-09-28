# Badge Soulbound NFT

Experimental Soroban contract for on-chain, non-transferable (soulbound)
badges representing arcade achievements and rank badges.

## Flow

1. `initialize` — bootstrap admin and collection metadata (one-time).
2. `mint` — the admin binds a badge to a player address.
3. `has_badge` — query used by other contracts for gatekeeping.
4. `transfer` — always fails with `NotTransferable`; badges cannot move.
5. `burn` — a player may discard a badge they hold, freeing the badge id up
   for that address to be re-minted later.

## Tests

```bash
cargo test
```
