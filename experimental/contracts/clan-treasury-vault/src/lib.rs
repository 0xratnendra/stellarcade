//! Clan Treasury Vault
//!
//! A multi-signature guild treasury for Stellarcade gaming clans. Members
//! pool match winnings into a shared vault; the clan leader and officers
//! vote on disbursement proposals, and a proposal executes only after it
//! reaches the configured signature threshold *and* a timelock has expired.
//!
//! ## Storage Strategy
//! - `instance()`: Leader, officer set, threshold, supported token, vault
//!   balance, and the proposal counter. Small config shared across the
//!   contract's lifetime.
//! - `persistent()`: `Proposal` per proposal_id, and the list of officers
//!   who voted per proposal_id. Each is bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Only officers (which may include the leader) may vote on proposals.
//! - An officer may cast at most one vote per proposal.
//! - A proposal executes only once quorum (threshold approvals) is reached
//!   AND `EXECUTION_TIMELOCK_LEDGERS` have elapsed since quorum was reached.
//! - Executed proposals cannot be executed again.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol, Vec};

pub use types::Error;
use types::{
    Deposited, Proposal, ProposalCreated, ProposalExecuted, ProposalVoted, VaultInitialized,
    EXECUTION_TIMELOCK_LEDGERS,
};

#[contract]
pub struct ClanTreasuryVault;

#[contractimpl]
impl ClanTreasuryVault {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the vault. May only be called once.
    ///
    /// `leader` is automatically granted officer-level voting power in
    /// addition to any addresses listed in `officers`. `threshold` is the
    /// number of distinct officer approvals a proposal needs before it can
    /// be executed (e.g. 2-of-3, 3-of-5). `token` is the SEP-41 token used
    /// for deposits and payouts.
    pub fn initialize(
        env: Env,
        leader: Address,
        officers: Vec<Address>,
        threshold: u32,
        token: Address,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        leader.require_auth();

        if threshold == 0 || threshold > officers.len() + 1 {
            return Err(Error::InvalidThreshold);
        }

        // The leader always has voting power; merge into the officer set
        // without duplicating.
        let mut full_officers: Vec<Address> = Vec::new(&env);
        full_officers.push_back(leader.clone());
        for o in officers.iter() {
            if o != leader && !full_officers.iter().any(|x| x == o) {
                full_officers.push_back(o.clone());
            }
        }

        storage::set_leader(&env, &leader);
        storage::set_officers(&env, &full_officers);
        storage::set_threshold(&env, threshold);
        storage::set_token(&env, &token);
        storage::set_balance(&env, 0);

        VaultInitialized {
            leader,
            threshold,
            token,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit
    // -----------------------------------------------------------------------

    /// Deposit `amount` of the vault's token into the treasury.
    ///
    /// Any address may contribute match winnings; `contributor` must
    /// authorize the call, and the funds are transferred from them to the
    /// contract via the SEP-41 token client.
    pub fn deposit(env: Env, contributor: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        contributor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contributor, &contract_address, &amount);

        let balance = storage::get_balance(&env)
            .checked_add(amount)
            .ok_or(Error::InvalidInput)?;
        storage::set_balance(&env, balance);

        Deposited {
            contributor,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_proposal
    // -----------------------------------------------------------------------

    /// Create a new payout proposal. Any officer (including the leader) may
    /// propose. Returns the new proposal's id.
    pub fn create_proposal(
        env: Env,
        proposer: Address,
        recipient: Address,
        amount: i128,
        memo: Symbol,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        proposer.require_auth();

        if !storage::is_officer(&env, &proposer) {
            return Err(Error::NotAnOfficer);
        }

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        if amount > storage::get_balance(&env) {
            return Err(Error::InsufficientBalance);
        }

        let id = storage::next_proposal_id(&env);
        let proposal = Proposal {
            id,
            proposer: proposer.clone(),
            recipient: recipient.clone(),
            amount,
            memo,
            quorum_reached_at: None,
            executed: false,
            approvals: 0,
        };
        storage::set_proposal(&env, &proposal);

        ProposalCreated {
            proposal_id: id,
            proposer,
            recipient,
            amount,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // vote_proposal
    // -----------------------------------------------------------------------

    /// Cast an officer vote on a proposal. Only officers may vote; each
    /// officer may vote at most once per proposal. A `false` vote records
    /// participation without contributing to quorum.
    pub fn vote_proposal(
        env: Env,
        officer: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        officer.require_auth();

        if !storage::is_officer(&env, &officer) {
            return Err(Error::NotAnOfficer);
        }

        let mut proposal = storage::get_proposal(&env, proposal_id)?;
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }

        let mut voters = storage::get_votes(&env, proposal_id);
        if voters.iter().any(|v| v == officer) {
            return Err(Error::AlreadyVoted);
        }
        voters.push_back(officer.clone());
        storage::set_votes(&env, proposal_id, &voters);

        if approve {
            proposal.approvals += 1;
            if proposal.approvals >= storage::get_threshold(&env)
                && proposal.quorum_reached_at.is_none()
            {
                proposal.quorum_reached_at = Some(env.ledger().sequence());
            }
        }
        storage::set_proposal(&env, &proposal);

        ProposalVoted {
            proposal_id,
            officer,
            approve,
            approvals: proposal.approvals,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // execute_proposal
    // -----------------------------------------------------------------------

    /// Execute a proposal once it has reached quorum and the post-quorum
    /// timelock has elapsed. Transfers `amount` of the vault token to
    /// `recipient`. Any caller may trigger execution once conditions are
    /// met; the proposer's original authorization already committed the
    /// payout terms, and the timelock/quorum gates protect the funds.
    pub fn execute_proposal(env: Env, proposal_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        let mut proposal = storage::get_proposal(&env, proposal_id)?;

        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }

        if proposal.approvals < storage::get_threshold(&env) {
            return Err(Error::QuorumNotReached);
        }
        let quorum_reached_at = proposal.quorum_reached_at.ok_or(Error::QuorumNotReached)?;

        let current_ledger = env.ledger().sequence();
        if current_ledger < quorum_reached_at + EXECUTION_TIMELOCK_LEDGERS {
            return Err(Error::TimelockNotExpired);
        }

        let balance = storage::get_balance(&env);
        if proposal.amount > balance {
            return Err(Error::InsufficientBalance);
        }

        proposal.executed = true;
        storage::set_proposal(&env, &proposal);
        storage::set_balance(&env, balance - proposal.amount);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &proposal.recipient, &proposal.amount);

        ProposalExecuted {
            proposal_id,
            recipient: proposal.recipient,
            amount: proposal.amount,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // get_vault_balance
    // -----------------------------------------------------------------------

    /// Return the current vault balance of the supported token.
    pub fn get_vault_balance(env: Env) -> i128 {
        storage::get_balance(&env)
    }

    // -----------------------------------------------------------------------
    // get_leader (read helper)
    // -----------------------------------------------------------------------

    /// Return the clan leader address.
    pub fn get_leader(env: Env) -> Address {
        storage::get_leader(&env)
    }

    // -----------------------------------------------------------------------
    // get_proposal (read helper)
    // -----------------------------------------------------------------------

    /// Return a proposal by id.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Result<Proposal, Error> {
        storage::get_proposal(&env, proposal_id)
    }
}
