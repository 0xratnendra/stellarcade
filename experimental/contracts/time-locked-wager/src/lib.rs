//! Time-Locked Wager
//!
//! A time-locked match challenge and forfeit escrow. A challenger issues a
//! challenge, locking their wager and specifying a response deadline; an
//! opponent accepts before that deadline, locking a matching wager. If the
//! opponent never accepts, the challenger reclaims their wager with no
//! fee once the deadline passes. Once accepted, if a player goes
//! unresponsive past the match's own timeout, the other player can claim
//! a forfeit victory — subject to a dispute grace period before the
//! payout finalizes, so a wrongly-accused player has a window to contest
//! it.
//!
//! ## Storage Strategy
//! - `instance()`: a single challenge counter.
//! - `persistent()`: `Challenge(id)`, bumped on every write.
//!
//! ## State machine
//! `Pending` -[accept]-> `Active` -[claim_timeout_forfeit]-> `ForfeitClaimed`
//! -[dispute]-> `Active` (again), or -[finalize, undisputed]-> `Resolved`.
//! `Pending` -[cancel, opponent no-show]-> `Cancelled`.
//!
//! ## Invariants
//! - `accept_challenge` must be called by the challenge's designated
//!   `opponent`, and only before `response_deadline_ledger`.
//! - `claim_timeout_forfeit` cannot be executed before
//!   `match_timeout_ledger` has passed, and only by a participant against
//!   the OTHER participant.
//! - A forfeit claim can be disputed only by the accused player, and only
//!   before `dispute_deadline_ledger`; a dispute returns the challenge to
//!   `Active` rather than resolving anything, so the claimant would need
//!   to wait for a fresh timeout to claim again.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{Challenge, ChallengeStatus, Error};
use types::{
    ChallengeAccepted, ChallengeCancelled, ChallengeCreated, ForfeitClaimed as ForfeitClaimedEvent,
    ForfeitDisputed, ForfeitFinalized, DISPUTE_GRACE_LEDGERS,
};

#[contract]
pub struct TimeLockedWager;

#[contractimpl]
impl TimeLockedWager {
    // -----------------------------------------------------------------------
    // create_challenge
    // -----------------------------------------------------------------------

    /// Issue a challenge: locks `challenger`'s `wager` of `token` and sets
    /// a response deadline `timeout` ledgers from now. Returns the new
    /// challenge's id.
    pub fn create_challenge(
        env: Env,
        challenger: Address,
        opponent: Address,
        token: Address,
        wager: i128,
        timeout: u32,
    ) -> Result<u64, Error> {
        challenger.require_auth();

        if challenger == opponent {
            return Err(Error::InvalidInput);
        }
        if wager <= 0 || timeout == 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&challenger, &contract_address, &wager);

        let id = storage::next_challenge_id(&env);
        let response_deadline_ledger = env.ledger().sequence() + timeout;
        let challenge = Challenge {
            id,
            challenger: challenger.clone(),
            opponent: opponent.clone(),
            token,
            wager,
            status: ChallengeStatus::Pending,
            response_deadline_ledger,
            match_timeout_ledger: None,
            forfeit_accused: None,
            forfeit_claimant: None,
            forfeit_dispute_deadline: None,
        };
        storage::set_challenge(&env, &challenge);

        ChallengeCreated {
            challenge_id: id,
            challenger,
            opponent,
            wager,
            response_deadline_ledger,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // accept_challenge
    // -----------------------------------------------------------------------

    /// The designated opponent accepts an outstanding challenge before its
    /// response deadline, locking a matching wager. `match_timeout` sets
    /// how many ledgers from acceptance either player has before the
    /// other may claim a timeout forfeit.
    pub fn accept_challenge(
        env: Env,
        opponent: Address,
        challenge_id: u64,
        match_timeout: u32,
    ) -> Result<(), Error> {
        opponent.require_auth();

        let mut challenge = storage::get_challenge(&env, challenge_id)?;
        if challenge.status != ChallengeStatus::Pending {
            return Err(Error::WrongChallengeState);
        }
        if opponent != challenge.opponent {
            return Err(Error::NotThePendingOpponent);
        }
        if env.ledger().sequence() >= challenge.response_deadline_ledger {
            return Err(Error::ChallengeExpired);
        }
        if match_timeout == 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &challenge.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&opponent, &contract_address, &challenge.wager);

        let match_timeout_ledger = env.ledger().sequence() + match_timeout;
        challenge.status = ChallengeStatus::Active;
        challenge.match_timeout_ledger = Some(match_timeout_ledger);
        storage::set_challenge(&env, &challenge);

        ChallengeAccepted {
            challenge_id,
            match_timeout_ledger,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // cancel_expired_challenge
    // -----------------------------------------------------------------------

    /// The challenger reclaims their wager, with no fee, once the response
    /// deadline has passed without the opponent accepting.
    pub fn cancel_expired_challenge(
        env: Env,
        challenger: Address,
        challenge_id: u64,
    ) -> Result<i128, Error> {
        challenger.require_auth();

        let mut challenge = storage::get_challenge(&env, challenge_id)?;
        if challenge.status != ChallengeStatus::Pending {
            return Err(Error::WrongChallengeState);
        }
        if challenger != challenge.challenger {
            return Err(Error::NotAParticipant);
        }
        if env.ledger().sequence() < challenge.response_deadline_ledger {
            return Err(Error::ChallengeNotExpired);
        }

        challenge.status = ChallengeStatus::Cancelled;
        storage::set_challenge(&env, &challenge);

        let token_client = token::Client::new(&env, &challenge.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &challenger, &challenge.wager);

        ChallengeCancelled { challenge_id }.publish(&env);

        Ok(challenge.wager)
    }

    // -----------------------------------------------------------------------
    // claim_timeout_forfeit
    // -----------------------------------------------------------------------

    /// A participant in an `Active` challenge claims that the OTHER
    /// participant has gone unresponsive past `match_timeout_ledger`.
    /// Starts a `DISPUTE_GRACE_LEDGERS` dispute window rather than paying
    /// out immediately, during which the accused player may dispute it.
    pub fn claim_timeout_forfeit(
        env: Env,
        claimant: Address,
        challenge_id: u64,
    ) -> Result<(), Error> {
        claimant.require_auth();

        let mut challenge = storage::get_challenge(&env, challenge_id)?;
        if challenge.status != ChallengeStatus::Active {
            return Err(Error::WrongChallengeState);
        }

        let accused = if claimant == challenge.challenger {
            challenge.opponent.clone()
        } else if claimant == challenge.opponent {
            challenge.challenger.clone()
        } else {
            return Err(Error::NotAParticipant);
        };

        let match_timeout_ledger = challenge
            .match_timeout_ledger
            .ok_or(Error::WrongChallengeState)?;
        if env.ledger().sequence() < match_timeout_ledger {
            return Err(Error::TimeoutNotYetReached);
        }

        let dispute_deadline_ledger = env.ledger().sequence() + DISPUTE_GRACE_LEDGERS;
        challenge.status = ChallengeStatus::ForfeitClaimed;
        challenge.forfeit_claimant = Some(claimant.clone());
        challenge.forfeit_accused = Some(accused.clone());
        challenge.forfeit_dispute_deadline = Some(dispute_deadline_ledger);
        storage::set_challenge(&env, &challenge);

        ForfeitClaimedEvent {
            challenge_id,
            claimant,
            accused,
            dispute_deadline_ledger,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // dispute_forfeit
    // -----------------------------------------------------------------------

    /// The player accused of abandoning the match disputes a forfeit claim
    /// against them, before the dispute deadline. Returns the challenge to
    /// `Active` (does not itself resolve who wins); the original claimant
    /// would need a fresh timeout to claim again.
    pub fn dispute_forfeit(env: Env, accused: Address, challenge_id: u64) -> Result<(), Error> {
        accused.require_auth();

        let mut challenge = storage::get_challenge(&env, challenge_id)?;
        if challenge.status != ChallengeStatus::ForfeitClaimed {
            return Err(Error::WrongChallengeState);
        }

        let claim_accused = challenge
            .forfeit_accused
            .clone()
            .ok_or(Error::WrongChallengeState)?;
        let dispute_deadline_ledger = challenge
            .forfeit_dispute_deadline
            .ok_or(Error::WrongChallengeState)?;
        if accused != claim_accused {
            return Err(Error::NotTheAccusedPlayer);
        }
        if env.ledger().sequence() >= dispute_deadline_ledger {
            return Err(Error::DisputeWindowExpired);
        }

        challenge.status = ChallengeStatus::Active;
        challenge.forfeit_claimant = None;
        challenge.forfeit_accused = None;
        challenge.forfeit_dispute_deadline = None;
        storage::set_challenge(&env, &challenge);

        ForfeitDisputed { challenge_id }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // finalize_forfeit
    // -----------------------------------------------------------------------

    /// Finalize an undisputed forfeit claim once its dispute deadline has
    /// passed, paying the full pot (both wagers) to the claimant.
    /// Callable by anyone once the deadline has passed; the dispute
    /// window itself is the safeguard, not caller authorization.
    pub fn finalize_forfeit(env: Env, challenge_id: u64) -> Result<i128, Error> {
        let mut challenge = storage::get_challenge(&env, challenge_id)?;
        if challenge.status != ChallengeStatus::ForfeitClaimed {
            return Err(Error::WrongChallengeState);
        }

        let claimant = challenge
            .forfeit_claimant
            .clone()
            .ok_or(Error::WrongChallengeState)?;
        let dispute_deadline_ledger = challenge
            .forfeit_dispute_deadline
            .ok_or(Error::WrongChallengeState)?;
        if env.ledger().sequence() < dispute_deadline_ledger {
            return Err(Error::TimeoutNotYetReached);
        }

        challenge.status = ChallengeStatus::Resolved;
        storage::set_challenge(&env, &challenge);

        let payout = challenge.wager * 2;
        let token_client = token::Client::new(&env, &challenge.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &claimant, &payout);

        ForfeitFinalized {
            challenge_id,
            winner: claimant,
            payout,
        }
        .publish(&env);

        Ok(payout)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_challenge(env: Env, challenge_id: u64) -> Result<Challenge, Error> {
        storage::get_challenge(&env, challenge_id)
    }
}
