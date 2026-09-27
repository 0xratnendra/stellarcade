# Staked Governance

An experimental Soroban contract implementing clan tournament rule voting
with staked governance. Members stake a governance token to receive voting
power, submit proposals, cast weighted votes, and finalize proposals that
reach a configured quorum.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Staking** — `stake` deposits the configured SEP-41 token and increases
  the caller's voting power 1:1.
- **Unstaking** — two-phase: `unstake` requests a withdrawal and starts a
  `UNSTAKE_COOLDOWN_LEDGERS` (~24h) cooldown; `claim_unstake` returns the
  tokens once the cooldown has elapsed. A voter with any active (not yet
  closed) vote cannot request an unstake at all — see "Vote locking" below.
  Only one unstake request may be pending at a time per voter.
- **Proposals** — any staked voter can call `create_proposal` with a
  description and a voting `duration` in ledgers.
- **Voting** — `vote` casts a `For`/`Against`/`Abstain` vote weighted by the
  voter's **current** staked balance (not a balance snapshotted at proposal
  creation — see "Known limitation" below). Each voter may vote once per
  proposal, and only before the proposal's `end_ledger`.
- **Vote locking** — casting a vote raises the voter's `LockedUntil` ledger
  to (at least) that proposal's `end_ledger`. `unstake` is rejected while
  the current ledger is still before `LockedUntil`, so a voter cannot
  unstake tokens they've committed to an in-flight proposal's outcome.
- **Execution** — `execute` is callable by anyone once voting has closed. It
  succeeds only if `votes_for` reaches the configured `quorum_bps` fraction
  of the **current** `total_staked` (again, not a value snapshotted at
  proposal creation). "Execution" here just finalizes the proposal and
  emits its tally — tournament rule changes have no further on-chain state
  for this contract to mutate.

### Known limitation: no per-proposal stake snapshot

Both a voter's weight in `vote` and the quorum denominator in `execute` use
the **live** `Staked`/`total_staked` values, not a value captured at
`create_proposal` time. This keeps the storage model simple (no per-voter,
per-proposal snapshot to write and later read), but means a large stake
acquired *after* a proposal is created can still vote on it with full
weight, and `total_staked` shifting between creation and execution changes
the effective quorum bar. A production version would likely snapshot
`total_staked` (and each voter's balance at first vote) at proposal
creation to close this gap; documented here rather than silently assumed
away.

## Storage layout

- `instance()`: `Token`, `QuorumBps`, `ProposalCount`, `TotalStaked` —
  small, fixed-size configuration.
- `persistent()`: `Staked(voter)`, `PendingUnstake(voter)`,
  `LockedUntil(voter)`, `Proposal(id)`, `HasVoted(voter, id)` — each bumped
  on every write.

## Interface

```rust
fn initialize(env: Env, token: Address, quorum_bps: u32) -> Result<(), Error>;
fn stake(env: Env, voter: Address, amount: i128) -> Result<i128, Error>;
fn unstake(env: Env, voter: Address, amount: i128) -> Result<(), Error>;
fn claim_unstake(env: Env, voter: Address) -> Result<i128, Error>;
fn create_proposal(env: Env, proposer: Address, description: String, duration: u32) -> Result<u64, Error>;
fn vote(env: Env, voter: Address, proposal_id: u64, vote_type: VoteType) -> Result<(), Error>;
fn execute(env: Env, proposal_id: u64) -> Result<(), Error>;
fn get_staked(env: Env, voter: Address) -> i128;
fn get_total_staked(env: Env) -> i128;
fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, Error>;
```

`stake`, `unstake`, `claim_unstake`, `create_proposal`, and `vote` all
enforce `require_auth()` on the caller they act on behalf of; `execute` is
permissionless because the quorum check already gates it.

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`, `InsufficientStake`,
`TokensCommittedToActiveVote`, `NoPendingUnstake`, `CooldownNotExpired`,
`ProposalNotFound`, `VotingClosed`, `AlreadyVoted`, `QuorumNotReached`,
`AlreadyExecuted`.

## Usage (pseudo-flow)

```text
initialize(token, quorum_bps=2_000)   // 20% quorum
stake(voter_a, 800)
stake(voter_b, 200)                    // total_staked = 1_000

id = create_proposal(voter_a, "Ban smurfing in ranked ladder", duration=50)
vote(voter_a, id, VoteType::For)       // 800 for >= 200 (20% of 1_000) quorum
// wait 50 ledgers for voting to close
execute(id)                             // finalizes, emits tally

unstake(voter_b, 200)                   // starts cooldown (voter_b never voted)
// wait UNSTAKE_COOLDOWN_LEDGERS ledgers
claim_unstake(voter_b)                  // returns the 200 tokens
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/staked-governance/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/staked-governance/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
