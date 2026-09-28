//! Escrow Arbitration Multisig
//!
//! A 2-of-3 arbiter dispute escrow for high-stakes tournament matches.
//! Both players deposit an equal wager when a dispute is opened; three
//! designated community arbiters each cast a ruling (a winner, or a
//! tie/invalidation split); once any two arbiters agree on the same
//! ruling, `execute_ruling` settles the escrow automatically.
//!
//! ## Consensus model
//!
//! Arbiters vote independently and their votes are public on-chain as
//! soon as cast. Settlement requires exactly 2-of-3 agreement on the
//! *same* ruling — not a simple majority of votes cast, and not the
//! first ruling reached — so a lone dissenting arbiter can never block or
//! force a settlement alone, and a single malicious/offline arbiter
//! cannot prevent the other two from agreeing.
//!
//! ## Storage Strategy
//! - `instance()`: the wager token and the next dispute id counter.
//! - `persistent()`: `Dispute(id)` and `Vote(dispute_id, arbiter)` — each
//!   bumped on every write.
//!
//! ## Invariants
//! - A dispute always has exactly 3 designated arbiters, fixed at creation.
//! - Only a dispute's own registered arbiters may cast a vote on it.
//! - An arbiter may vote at most once per dispute (no vote changes).
//! - `execute_ruling` requires 2-of-3 agreement and settles a dispute at
//!   most once.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use types::{Dispute, DisputeCreated, RulingExecuted, VoteCast, ARBITER_FEE_BPS};
pub use types::{Error, Ruling};

#[contract]
pub struct EscrowArbitrationMultisig;

#[contractimpl]
impl EscrowArbitrationMultisig {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract with the token used for wagers. May only
    /// be called once.
    pub fn initialize(env: Env, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_token(&env, &token);
        storage::set_next_dispute_id(&env, 1);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_dispute
    // -----------------------------------------------------------------------

    /// Open a new dispute between `p1` and `p2`, each depositing `wager`
    /// into escrow, with exactly 3 designated `arbiters`. Both players
    /// must authorize the call (each is charged their own deposit).
    pub fn create_dispute(
        env: Env,
        p1: Address,
        p2: Address,
        wager: i128,
        arbiters: Vec<Address>,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        p1.require_auth();
        p2.require_auth();

        if wager <= 0 {
            return Err(Error::InvalidInput);
        }
        if arbiters.len() != 3 {
            return Err(Error::InvalidInput);
        }
        // Arbiters must be distinct from each other and from both players,
        // otherwise a single address could unilaterally out-vote the
        // consensus requirement.
        for i in 0..arbiters.len() {
            let a = arbiters.get(i).unwrap();
            if a == p1 || a == p2 {
                return Err(Error::InvalidInput);
            }
            for j in (i + 1)..arbiters.len() {
                if a == arbiters.get(j).unwrap() {
                    return Err(Error::InvalidInput);
                }
            }
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&p1, &contract_address, &wager);
        token_client.transfer(&p2, &contract_address, &wager);

        let dispute_id = storage::get_next_dispute_id(&env);
        storage::set_next_dispute_id(&env, dispute_id + 1);

        let dispute = Dispute {
            dispute_id,
            p1: p1.clone(),
            p2: p2.clone(),
            wager,
            arbiters,
            settled: false,
        };
        storage::set_dispute(&env, &dispute);

        DisputeCreated {
            dispute_id,
            p1,
            p2,
            wager,
        }
        .publish(&env);

        Ok(dispute_id)
    }

    // -----------------------------------------------------------------------
    // cast_vote
    // -----------------------------------------------------------------------

    /// Cast `arbiter`'s ruling on `dispute_id`. `arbiter` must be one of
    /// the dispute's 3 registered arbiters, and may vote at most once.
    pub fn cast_vote(
        env: Env,
        arbiter: Address,
        dispute_id: u64,
        ruling: Ruling,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        arbiter.require_auth();

        let dispute = storage::get_dispute(&env, dispute_id)?;
        if dispute.settled {
            return Err(Error::DisputeAlreadySettled);
        }
        if !dispute.arbiters.contains(&arbiter) {
            return Err(Error::NotARegisteredArbiter);
        }
        if let Ruling::Winner(w) = &ruling {
            if *w != dispute.p1 && *w != dispute.p2 {
                return Err(Error::InvalidRuling);
            }
        }
        if storage::get_vote(&env, dispute_id, &arbiter).is_some() {
            return Err(Error::ArbiterAlreadyVoted);
        }

        storage::set_vote(&env, dispute_id, &arbiter, &ruling);

        VoteCast {
            dispute_id,
            arbiter,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // execute_ruling
    // -----------------------------------------------------------------------

    /// Settle `dispute_id` once 2-of-3 arbiters have cast the same
    /// ruling. Deducts `ARBITER_FEE_BPS` from the wager pool, split evenly
    /// across the 3 registered arbiters, then pays the remainder to the
    /// ruled winner (or splits it evenly between both players for a
    /// `Ruling::Split`).
    pub fn execute_ruling(env: Env, dispute_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        let dispute = storage::get_dispute(&env, dispute_id)?;
        if dispute.settled {
            return Err(Error::DisputeAlreadySettled);
        }

        let mut votes: Vec<Ruling> = Vec::new(&env);
        for i in 0..dispute.arbiters.len() {
            let arbiter = dispute.arbiters.get(i).unwrap();
            if let Some(ruling) = storage::get_vote(&env, dispute_id, &arbiter) {
                votes.push_back(ruling);
            }
        }

        let consensus = find_two_of_three_consensus(&votes).ok_or(Error::NoRulingConsensusYet)?;

        let total_pool = dispute.wager.checked_mul(2).ok_or(Error::InvalidInput)?;
        let arbiter_fee_total = total_pool
            .checked_mul(ARBITER_FEE_BPS)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(Error::InvalidInput)?;
        let distributable = total_pool
            .checked_sub(arbiter_fee_total)
            .ok_or(Error::InvalidInput)?;

        let mut settled = dispute.clone();
        settled.settled = true;
        storage::set_dispute(&env, &settled);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();

        match consensus {
            Ruling::Winner(winner) => {
                token_client.transfer(&contract_address, &winner, &distributable);
            }
            Ruling::Split => {
                let half = distributable / 2;
                token_client.transfer(&contract_address, &dispute.p1, &half);
                // Remainder (from odd-amount rounding) goes to p2 so the
                // full distributable amount is always paid out, not left
                // dangling in the contract.
                let remainder = distributable - half;
                token_client.transfer(&contract_address, &dispute.p2, &remainder);
            }
        }

        if arbiter_fee_total > 0 {
            let per_arbiter = arbiter_fee_total / 3;
            let mut paid = 0i128;
            for i in 0..dispute.arbiters.len() {
                let arbiter = dispute.arbiters.get(i).unwrap();
                // Last arbiter absorbs any remainder from integer division
                // so the full fee is always paid out.
                let amount = if i == dispute.arbiters.len() - 1 {
                    arbiter_fee_total - paid
                } else {
                    per_arbiter
                };
                token_client.transfer(&contract_address, &arbiter, &amount);
                paid += amount;
            }
        }

        RulingExecuted {
            dispute_id,
            arbiter_fee_total,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, Error> {
        storage::get_dispute(&env, dispute_id)
    }

    pub fn get_vote(env: Env, dispute_id: u64, arbiter: Address) -> Option<Ruling> {
        storage::get_vote(&env, dispute_id, &arbiter)
    }
}

/// Returns the ruling shared by at least 2 of the given votes, or `None`
/// if no ruling has 2+ votes. With exactly 3 arbiters, at most one ruling
/// value can ever reach this threshold at a time.
fn find_two_of_three_consensus(votes: &Vec<Ruling>) -> Option<Ruling> {
    for i in 0..votes.len() {
        let candidate = votes.get(i).unwrap();
        let mut count = 1u32;
        for j in 0..votes.len() {
            if i == j {
                continue;
            }
            if votes.get(j).unwrap() == candidate {
                count += 1;
            }
        }
        if count >= 2 {
            return Some(candidate);
        }
    }
    None
}
