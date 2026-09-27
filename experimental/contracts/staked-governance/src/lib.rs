//! Staked Governance
//!
//! Lets arcade clan members stake tokens for voting power and vote on
//! tournament rule proposals. Voting weight is proportional to a voter's
//! staked balance at the time they vote; proposals pass once `votes_for`
//! reaches the configured quorum fraction of `total_staked` at the time of
//! execution, and can then be executed by anyone. See `vote` and `execute`'s
//! doc comments for why this uses the *current* total rather than a
//! snapshot, and the tradeoff that implies.
//!
//! ## Storage Strategy
//! - `instance()`: Token, quorum (in basis points of total staked),
//!   proposal counter, and running total staked.
//! - `persistent()`: `Staked(voter)`, `PendingUnstake(voter)`,
//!   `LockedUntil(voter)`, `Proposal(id)`, and `HasVoted(voter, id)` —
//!   each bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - A voter's voting weight on `vote` is their staked balance *at the time
//!   of voting* (not a snapshot at proposal creation) — see `vote`'s doc
//!   comment for the rationale and its limitation.
//! - Staked tokens cannot be unstaked while the voter has any active
//!   (not-yet-`end_ledger`) vote outstanding.
//! - Unstaking is two-phase: `unstake` starts a cooldown; `claim_unstake`
//!   returns the tokens only once `UNSTAKE_COOLDOWN_LEDGERS` has elapsed.
//! - A proposal can be voted on only before its `end_ledger`, and executed
//!   only after, once, and only if quorum was reached.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

pub use types::{Error, VoteType};
use types::{
    PendingUnstake, Proposal, ProposalCreated, ProposalExecuted, Staked, UnstakeClaimed,
    UnstakeRequested, VoteCast, UNSTAKE_COOLDOWN_LEDGERS,
};

#[contract]
pub struct StakedGovernance;

#[contractimpl]
impl StakedGovernance {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    ///
    /// `quorum_bps` is the fraction (in basis points, e.g. `2_000` = 20%) of
    /// `total_staked` at execution time that `votes_for` must reach for a
    /// proposal to be executable.
    pub fn initialize(env: Env, token: Address, quorum_bps: u32) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if quorum_bps == 0 || quorum_bps > 10_000 {
            return Err(Error::InvalidInput);
        }

        storage::set_token(&env, &token);
        storage::set_quorum_bps(&env, quorum_bps);
        storage::set_total_staked(&env, 0);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // stake
    // -----------------------------------------------------------------------

    /// Stake `amount` of the governance token, increasing the voter's
    /// voting power by the same amount.
    pub fn stake(env: Env, voter: Address, amount: i128) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        voter.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&voter, &contract_address, &amount);

        let new_stake = storage::get_staked(&env, &voter)
            .checked_add(amount)
            .ok_or(Error::InvalidInput)?;
        storage::set_staked(&env, &voter, new_stake);

        let total = storage::get_total_staked(&env)
            .checked_add(amount)
            .ok_or(Error::InvalidInput)?;
        storage::set_total_staked(&env, total);

        Staked {
            voter,
            amount,
            total_staked: new_stake,
        }
        .publish(&env);

        Ok(new_stake)
    }

    // -----------------------------------------------------------------------
    // unstake
    // -----------------------------------------------------------------------

    /// Request to unstake `amount`. Starts a cooldown; the tokens are not
    /// returned until `claim_unstake` is called after
    /// `UNSTAKE_COOLDOWN_LEDGERS` have elapsed.
    ///
    /// Rejected outright (not queued) if the voter has any active vote
    /// outstanding — see the module doc's invariants. A voter with a
    /// pending unstake request may not request another until the first is
    /// claimed, to keep the cooldown bookkeeping to one entry per voter.
    pub fn unstake(env: Env, voter: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        voter.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        if env.ledger().sequence() < storage::get_locked_until(&env, &voter) {
            return Err(Error::TokensCommittedToActiveVote);
        }
        if storage::get_pending_unstake(&env, &voter).is_some() {
            return Err(Error::TokensCommittedToActiveVote);
        }

        let staked = storage::get_staked(&env, &voter);
        if amount > staked {
            return Err(Error::InsufficientStake);
        }

        storage::set_staked(&env, &voter, staked - amount);
        let total = storage::get_total_staked(&env) - amount;
        storage::set_total_staked(&env, total);

        let claimable_at = env.ledger().sequence() + UNSTAKE_COOLDOWN_LEDGERS;
        storage::set_pending_unstake(
            &env,
            &voter,
            &PendingUnstake {
                amount,
                claimable_at,
            },
        );

        UnstakeRequested {
            voter,
            amount,
            claimable_at,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_unstake
    // -----------------------------------------------------------------------

    /// Claim a previously requested unstake once its cooldown has elapsed,
    /// returning the tokens to the voter.
    pub fn claim_unstake(env: Env, voter: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        voter.require_auth();

        let pending = storage::get_pending_unstake(&env, &voter).ok_or(Error::NoPendingUnstake)?;
        if env.ledger().sequence() < pending.claimable_at {
            return Err(Error::CooldownNotExpired);
        }

        storage::clear_pending_unstake(&env, &voter);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &voter, &pending.amount);

        UnstakeClaimed {
            voter,
            amount: pending.amount,
        }
        .publish(&env);

        Ok(pending.amount)
    }

    // -----------------------------------------------------------------------
    // create_proposal
    // -----------------------------------------------------------------------

    /// Create a new proposal, open for voting for `duration` ledgers from
    /// now. Any staked voter may propose. Returns the new proposal's id.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        description: String,
        duration: u32,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        proposer.require_auth();

        if duration == 0 {
            return Err(Error::InvalidInput);
        }
        if storage::get_staked(&env, &proposer) <= 0 {
            return Err(Error::InsufficientStake);
        }

        let id = storage::next_proposal_id(&env);
        let end_ledger = env.ledger().sequence() + duration;
        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            description,
            end_ledger,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
            executed: false,
        };
        storage::set_proposal(&env, &proposal);

        ProposalCreated {
            proposal_id: id,
            proposer,
            end_ledger,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // vote
    // -----------------------------------------------------------------------

    /// Cast a weighted vote on `proposal_id`. Weight is the voter's staked
    /// balance *at the time of voting*: this contract does not snapshot
    /// balances at proposal-creation time, so a voter who stakes more
    /// tokens between proposal creation and their vote votes with their
    /// larger, current balance. This keeps the accounting simple (no
    /// separate snapshot storage per proposal) at the cost of not fully
    /// preventing a large stake acquired mid-vote from swaying an
    /// in-flight proposal; flagged here as a known limitation rather than
    /// silently assumed away.
    ///
    /// Each voter may vote at most once per proposal. Voting bumps the
    /// voter's `LockedUntil` ledger to (at least) this proposal's
    /// `end_ledger`, so `unstake` is rejected until every proposal the
    /// voter has participated in has closed.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_type: VoteType,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        voter.require_auth();

        let mut proposal = storage::get_proposal(&env, proposal_id)?;
        if env.ledger().sequence() >= proposal.end_ledger {
            return Err(Error::VotingClosed);
        }
        if storage::has_voted(&env, &voter, proposal_id) {
            return Err(Error::AlreadyVoted);
        }

        let weight = storage::get_staked(&env, &voter);
        if weight <= 0 {
            return Err(Error::InsufficientStake);
        }

        storage::set_has_voted(&env, &voter, proposal_id);
        if proposal.end_ledger > storage::get_locked_until(&env, &voter) {
            storage::set_locked_until(&env, &voter, proposal.end_ledger);
        }

        match vote_type {
            VoteType::For => proposal.votes_for += weight,
            VoteType::Against => proposal.votes_against += weight,
            VoteType::Abstain => proposal.votes_abstain += weight,
        }
        storage::set_proposal(&env, &proposal);

        VoteCast {
            proposal_id,
            voter,
            vote_type,
            weight,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // execute
    // -----------------------------------------------------------------------

    /// Finalize and execute a proposal once voting has closed. Requires
    /// `votes_for` to reach the configured quorum fraction of the *current*
    /// `total_staked` (not a value snapshotted at proposal creation — the
    /// same simplification `vote`'s weight uses). Any caller may trigger
    /// execution; the quorum check itself is the safeguard.
    ///
    /// "Execute" here means marking the proposal finalized and emitting its
    /// final tally — this experimental contract governs *tournament rule*
    /// proposals, which have no on-chain state of their own to mutate, so
    /// there is no further on-chain action to perform beyond recording that
    /// the proposal passed.
    pub fn execute(env: Env, proposal_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        let mut proposal = storage::get_proposal(&env, proposal_id)?;
        if env.ledger().sequence() < proposal.end_ledger {
            return Err(Error::VotingClosed);
        }
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }

        let quorum_bps = storage::get_quorum_bps(&env) as i128;
        let total_staked = storage::get_total_staked(&env);
        let required = total_staked
            .checked_mul(quorum_bps)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(Error::InvalidInput)?;
        if proposal.votes_for < required {
            return Err(Error::QuorumNotReached);
        }

        proposal.executed = true;
        storage::set_proposal(&env, &proposal);

        ProposalExecuted {
            proposal_id,
            votes_for: proposal.votes_for,
            votes_against: proposal.votes_against,
            votes_abstain: proposal.votes_abstain,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Return `voter`'s currently staked (voting-eligible) balance.
    pub fn get_staked(env: Env, voter: Address) -> i128 {
        storage::get_staked(&env, &voter)
    }

    /// Return the running total staked across all voters.
    pub fn get_total_staked(env: Env) -> i128 {
        storage::get_total_staked(&env)
    }

    /// Return a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, Error> {
        storage::get_proposal(&env, proposal_id)
    }
}
