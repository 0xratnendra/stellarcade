# Ticket Raffle Escrow

A Soroban raffle contract: players buy tickets at a fixed price before a deadline, and the admin
draws a verifiably fair winner who automatically receives the full prize pool.

## Methods

| Method | Description |
|---|---|
| `initialize(env, admin, token)` | One-time setup. |
| `create_raffle(env, admin, ticket_price, end_time, max_tickets)` | Admin-only. Opens a new raffle; `end_time` is a unix timestamp, `max_tickets` is the per-wallet cap. |
| `buy_tickets(env, player, raffle_id, count)` | Buys `count` tickets, transferring `count * ticket_price` from `player` into escrow. Requires `player.require_auth()`. |
| `draw_winner(env, admin, raffle_id, seed)` | Admin-only. After `end_time`, derives the winning ticket from `seed` and pays the full pool to its owner. |
| `get_raffle(env, raffle_id)` | Read the raffle's current state. |
| `get_player_ticket_count(env, raffle_id, player)` | Read a player's ticket count in a raffle. |

## Provable fairness

Ticket ranges are fixed and public before any random seed exists (the "commit"). `draw_winner`
derives the winning ticket id from `sha256(seed || raffle_id) % tickets_sold` (the "reveal"), so
once sales close, nobody — including the revealer — can change which tickets exist to influence
who wins.

## Invariants enforced

- A wallet cannot buy tickets pushing its raffle total above `max_tickets_per_wallet`.
- Ticket purchases are rejected once `end_time` has passed.
- A raffle can be drawn only once, only after `end_time`, and only with at least one ticket sold.
- The prize is paid out automatically and atomically as part of `draw_winner` — there is no
  separate claim step, so it cannot go unclaimed.

## Testing

```bash
cargo test -p ticket-raffle-escrow
```

Covers: ticket purchases accumulating the pool, the per-wallet ticket cap (both at and past the
limit), sales locking after `end_time`, draw timing/ordering guards (before `end_time`, zero
tickets sold, drawing twice), and the deterministic seed-based winner selection paying out the
full pool to the ticket's owner.
