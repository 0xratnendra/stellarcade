# token-vesting-arcade (experimental)

Linear-with-cliff token vesting for esports team prize grants and
contributor reward schedules.

- `create_schedule(admin, beneficiary, total_amount, start, cliff, duration, revocable) -> schedule_id`
- `claim(schedule_id, beneficiary) -> u128` — amount newly unlocked and claimed; 0 before the cliff.
- `revoke(admin, schedule_id) -> u128` — freezes vesting, returns the unvested remainder owed to the admin (revocable schedules only).
- `get_schedule_status(schedule_id) -> VestingSummary` — total/vested/claimed/locked amounts.

Amounts are `u128` ledger values (no `token::Client` transfers), matching
`coinflip-streak`/`lottery-syndicate`'s style elsewhere in this workspace.
