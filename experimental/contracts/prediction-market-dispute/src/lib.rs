//! Prediction market dispute escrow (experimental).
//!
//! Two-phase settlement: oracle reports an outcome with a bond, challengers may
//! stake a counter-bond during a challenge window, then the market finalizes or
//! an arbiter resolves active disputes.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{DisputeStatusSummary, Error, MarketPhase};
use types::{MarketDispute, CHALLENGE_WINDOW_LEDGERS};

#[contract]
pub struct PredictionMarketDispute;

#[contractimpl]
impl PredictionMarketDispute {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&types::DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_arbiter(&env, &admin);
        Ok(())
    }

    pub fn report_outcome(
        env: Env,
        oracle: Address,
        market_id: u64,
        winning_outcome: bool,
        bond_amount: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        oracle.require_auth();
        if bond_amount <= 0 {
            return Err(Error::InvalidBond);
        }

        if storage::load_market(&env, market_id).is_ok() {
            return Err(Error::AlreadyFinalized);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&oracle, &contract, &bond_amount);

        let deadline = env.ledger().sequence() + CHALLENGE_WINDOW_LEDGERS;
        let market = MarketDispute {
            oracle: oracle.clone(),
            reported_outcome: winning_outcome,
            challenge_deadline_ledger: deadline,
            oracle_bond: bond_amount,
            challenger: None,
            challenge_bond: 0,
            final_outcome: None,
            phase: MarketPhase::Reported,
            pool: bond_amount,
            payout_claimed: false,
        };
        storage::save_market(&env, market_id, &market);
        Ok(())
    }

    pub fn challenge_outcome(
        env: Env,
        challenger: Address,
        market_id: u64,
        challenge_bond: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        challenger.require_auth();
        if challenge_bond <= 0 {
            return Err(Error::InvalidBond);
        }

        let mut market = storage::load_market(&env, market_id)?;
        if market.phase != MarketPhase::Reported {
            return Err(Error::AlreadyFinalized);
        }
        if env.ledger().sequence() > market.challenge_deadline_ledger {
            return Err(Error::ChallengeWindowClosed);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&challenger, &contract, &challenge_bond);

        market.challenger = Some(challenger);
        market.challenge_bond = challenge_bond;
        market.pool = market
            .pool
            .checked_add(challenge_bond)
            .ok_or(Error::InvalidBond)?;
        market.phase = MarketPhase::Disputed;
        storage::save_market(&env, market_id, &market);
        Ok(())
    }

    pub fn finalize_undisputed(env: Env, market_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        let mut market = storage::load_market(&env, market_id)?;
        if market.phase != MarketPhase::Reported {
            return Err(Error::AlreadyFinalized);
        }
        if env.ledger().sequence() <= market.challenge_deadline_ledger {
            return Err(Error::ChallengeWindowOpen);
        }
        market.final_outcome = Some(market.reported_outcome);
        market.phase = MarketPhase::Finalized;
        storage::save_market(&env, market_id, &market);
        Ok(())
    }

    pub fn arbitrate(
        env: Env,
        arbiter: Address,
        market_id: u64,
        final_outcome: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        arbiter.require_auth();
        if arbiter != storage::get_arbiter(&env) {
            return Err(Error::Unauthorized);
        }

        let mut market = storage::load_market(&env, market_id)?;
        if market.phase != MarketPhase::Disputed {
            return Err(Error::NotDisputed);
        }
        market.final_outcome = Some(final_outcome);
        market.phase = MarketPhase::Finalized;
        storage::save_market(&env, market_id, &market);
        Ok(())
    }

    pub fn claim_resolution_payout(
        env: Env,
        claimant: Address,
        market_id: u64,
    ) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        claimant.require_auth();

        let market = storage::load_market(&env, market_id)?;
        if market.phase != MarketPhase::Finalized {
            return Err(Error::PayoutsFrozen);
        }
        if market.payout_claimed {
            return Err(Error::AlreadyClaimed);
        }

        let outcome = market.final_outcome.ok_or(Error::NothingToClaim)?;
        let mut payout = 0i128;
        if outcome == market.reported_outcome && claimant == market.oracle {
            payout = market.oracle_bond + market.challenge_bond;
        } else if let Some(ref challenger) = market.challenger {
            if outcome != market.reported_outcome && claimant == *challenger {
                payout = market.pool;
            }
        }
        if payout <= 0 {
            return Err(Error::NothingToClaim);
        }

        let token = storage::get_token(&env);
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &claimant,
            &payout,
        );

        let mut updated = market;
        updated.payout_claimed = true;
        storage::save_market(&env, market_id, &updated);
        Ok(payout)
    }

    pub fn get_market_dispute_status(env: Env, market_id: u64) -> DisputeStatusSummary {
        match storage::load_market(&env, market_id) {
            Ok(m) => DisputeStatusSummary {
                found: true,
                phase: m.phase.clone(),
                challenge_deadline_ledger: m.challenge_deadline_ledger,
                disputed: m.phase == MarketPhase::Disputed,
                final_outcome: m.final_outcome,
                payouts_frozen: m.phase != MarketPhase::Finalized,
            },
            Err(_) => DisputeStatusSummary {
                found: false,
                phase: MarketPhase::Open,
                challenge_deadline_ledger: 0,
                disputed: false,
                final_outcome: None,
                payouts_frozen: true,
            },
        }
    }
}
