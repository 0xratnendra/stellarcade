# Escrow Arbitration Multisig

A Soroban 2-of-3 arbiter dispute escrow for high-stakes tournament matches. Both players deposit
an equal wager, three designated arbiters each cast a ruling, and once two agree on the same
outcome the escrow settles automatically.

## Methods

| Method | Description |
|---|---|
| `initialize(env, token)` | One-time setup. |
| `create_dispute(env, p1, p2, wager, arbiters)` | Both `p1` and `p2` deposit `wager`; `arbiters` must be exactly 3 distinct addresses, none of which is `p1` or `p2`. |
| `cast_vote(env, arbiter, dispute_id, ruling)` | One of the dispute's 3 registered arbiters casts a `Ruling` (`Winner(address)` or `Split`). Each arbiter may vote once. |
| `execute_ruling(env, dispute_id)` | Settles the dispute once 2-of-3 arbiters agree on the same ruling. |
| `get_dispute` / `get_vote` | Read helpers. |

## Consensus model

Arbiters vote independently; settlement requires exactly 2-of-3 agreement on the *same* ruling —
not a simple majority of votes cast. A lone dissenting arbiter can never block settlement, and a
single unavailable or malicious arbiter cannot prevent the other two from agreeing.

## Payout

- A 2% service commission (`ARBITER_FEE_BPS`) is deducted from the total wager pool (`2 * wager`)
  and split evenly across all 3 registered arbiters, regardless of how each voted.
- The remaining pool goes to the ruled winner, or is split evenly between both players for a
  `Ruling::Split` (tie / match invalidation).
- All payouts happen atomically inside `execute_ruling` — there is no separate claim step.

## Invariants enforced

- `.require_auth()` is enforced on both players depositing and on every arbiter casting a vote.
- Only a dispute's own 3 registered arbiters may vote on it; an outsider is rejected.
- An arbiter may vote at most once per dispute.
- A dispute can be settled at most once.

## Testing

```bash
cargo test -p escrow-arbitration-multisig
```

Covers: wager locking from both players on creation, arbiter-count/identity validation at
creation, two matching votes triggering execution and paying the winner, a `Split` ruling paying
both players while conserving total value across players + arbiters, refusing to execute with no
2-of-3 consensus (including a genuinely 3-way disagreement), rejecting a non-arbiter's vote,
rejecting a double vote from the same arbiter, and rejecting a vote after settlement.
