//! Sealed-bid duel escrow (experimental).
//!
//! Two high-rollers stake hidden wagers via commit-reveal:
//! SHA256(wager_be_bytes || salt). Highest revealed wager wins the pot, but —
//! second-price settlement — the winner's net gain is capped so the loser
//! effectively refunds only the excess over their own (second) bid. A player
//! who fails to reveal inside the window forfeits their stake.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env};

pub use types::{
    DuelPhase, Error, SealedDuel, MIN_WAGER, REVEAL_WINDOW_LEDGERS,
};
use types::DataKey;

#[contract]
pub struct SealedBidDuel;

/// Recompute the commitment hash for (wager, salt). Both sides must produce
/// the exact bytes they committed to.
pub fn commitment_hash(env: &Env, wager: i128, salt: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.extend_from_slice(&wager.to_be_bytes());
    buf.extend_from_slice(&salt.to_array());
    env.crypto().sha256(&buf).into()
}

#[contractimpl]
impl SealedBidDuel {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if token == env.current_contract_address() {
            return Err(Error::InvalidStake);
        }
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        Ok(())
    }

    /// Open a duel: escrow the creator's stake and lock their commitment.
    pub fn create_duel(
        env: Env,
        creator: Address,
        commitment: BytesN<32>,
        stake: i128,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        creator.require_auth();
        if stake < MIN_WAGER {
            return Err(Error::InvalidStake);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&creator, &contract, &stake);

        let duel_id = storage::next_duel_id(&env);
        let duel = SealedDuel {
            duel_id,
            creator: creator.clone(),
            opponent: None,
            creator_commitment: commitment,
            opponent_commitment: None,
            stake,
            reveal_deadline_ledger: 0,
            creator_reveal: None,
            opponent_reveal: None,
            winner: None,
            settled: false,
            phase: DuelPhase::Open,
        };
        storage::save_duel(&env, &duel);
        Ok(duel_id)
    }

    /// Join an open duel: escrow the opponent's stake and lock their
    /// commitment; the reveal window starts now.
    pub fn join_duel(
        env: Env,
        opponent: Address,
        duel_id: u64,
        commitment: BytesN<32>,
        stake: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        opponent.require_auth();

        let mut duel = storage::load_duel(&env, duel_id)?;
        if duel.phase != DuelPhase::Open {
            return Err(Error::DuelNotOpen);
        }
        if duel.creator == opponent {
            return Err(Error::AlreadyJoined);
        }
        if stake != duel.stake {
            return Err(Error::InvalidStake);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&opponent, &contract, &stake);

        duel.opponent = Some(opponent);
        duel.opponent_commitment = Some(commitment);
        duel.reveal_deadline_ledger = env.ledger().sequence() + REVEAL_WINDOW_LEDGERS;
        duel.phase = DuelPhase::Committed;
        storage::save_duel(&env, &duel);
        Ok(())
    }

    /// Reveal plaintext wager + salt inside the window. The reveal is
    /// authenticated and must match the original commitment exactly.
    pub fn reveal_bid(
        env: Env,
        player: Address,
        duel_id: u64,
        wager: i128,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let mut duel = storage::load_duel(&env, duel_id)?;
        if duel.phase != DuelPhase::Committed {
            return Err(Error::DuelNotCommitted);
        }
        if env.ledger().sequence() >= duel.reveal_deadline_ledger {
            return Err(Error::RevealWindowClosed);
        }

        let expected = if player == duel.creator {
            if duel.creator_reveal.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            duel.creator_commitment.clone()
        } else if duel.opponent.as_ref() == Some(&player) {
            if duel.opponent_reveal.is_some() {
                return Err(Error::AlreadyRevealed);
            }
            duel.opponent_commitment
                .clone()
                .ok_or(Error::DuelNotCommitted)?
        } else {
            return Err(Error::Unauthorized);
        };

        // FAILURE MODE: mismatched hash reveals are rejected explicitly.
        if commitment_hash(&env, wager, &salt) != expected {
            return Err(Error::CommitmentMismatch);
        }

        if player == duel.creator {
            duel.creator_reveal = Some(wager);
        } else {
            duel.opponent_reveal = Some(wager);
        }
        storage::save_duel(&env, &duel);
        Ok(())
    }

    /// Settle the duel once both bids are revealed (second-price: winner nets
    /// their stake + (own winning bid − losing/second bid)) or, after the
    /// reveal deadline, when exactly one side revealed (forfeit) or the
    /// deadline passed with no reveals (both stakes refunded).
    pub fn finalize_duel(env: Env, duel_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        let mut duel = storage::load_duel(&env, duel_id)?;
        if duel.settled {
            return Err(Error::AlreadyFinalized);
        }
        if duel.phase != DuelPhase::Committed {
            return Err(Error::NotReadyToFinalize);
        }

        let now = env.ledger().sequence();
        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let pot = duel.stake * 2;

        match (duel.creator_reveal, duel.opponent_reveal) {
            (Some(creator_bid), Some(opponent_bid)) => {
                // Second-price settlement: highest wager wins; the winner's
                // price is the second (lower) bid. Excess stake is refunded.
                let (winner, winning_bid, losing_bid, loser) =
                    if creator_bid >= opponent_bid {
                        (duel.creator.clone(), creator_bid, opponent_bid, duel.opponent.clone().ok_or(Error::NotReadyToFinalize)?)
                    } else {
                        (duel.opponent.clone().ok_or(Error::NotReadyToFinalize)?, opponent_bid, creator_bid, duel.creator.clone())
                    };

                // Second-price settlement: the loser refunds the amount by
                // which the winner's bid exceeds the second (losing) bid,
                // capped at the stake. Winner nets the excess; loser pays it.
                let excess = (winning_bid - losing_bid).max(0).min(duel.stake);
                let payout = duel.stake + excess;

                token_client.transfer(&contract, &winner, &payout);
                token_client.transfer(&contract, &loser, &(pot - payout));
                duel.winner = Some(winner);
                duel.settled = true;
                duel.phase = DuelPhase::Finalized;
            }
            (Some(_), None) if now >= duel.reveal_deadline_ledger => {
                // Opponent failed to reveal: forfeits stake to the creator.
                token_client.transfer(&contract, &duel.creator.clone(), &pot);
                duel.winner = Some(duel.creator.clone());
                duel.settled = true;
                duel.phase = DuelPhase::Forfeited;
            }
            (None, Some(_)) if now >= duel.reveal_deadline_ledger => {
                // Creator failed to reveal: forfeits stake to the opponent.
                let opponent = duel.opponent.clone().ok_or(Error::NotReadyToFinalize)?;
                token_client.transfer(&contract, &opponent, &pot);
                duel.winner = Some(opponent);
                duel.settled = true;
                duel.phase = DuelPhase::Forfeited;
            }
            (None, None) if now >= duel.reveal_deadline_ledger => {
                // Neither revealed in time: both stakes refunded.
                token_client.transfer(&contract, &duel.creator.clone(), &duel.stake);
                let opponent = duel.opponent.clone().ok_or(Error::NotReadyToFinalize)?;
                token_client.transfer(&contract, &opponent, &duel.stake);
                duel.settled = true;
                duel.phase = DuelPhase::Forfeited;
            }
            _ => {
                return Err(Error::RevealWindowOpen);
            }
        }

        storage::save_duel(&env, &duel);
        Ok(())
    }

    /// View: full duel state.
    pub fn get_duel(env: Env, duel_id: u64) -> Result<SealedDuel, Error> {
        storage::load_duel(&env, duel_id)
    }
}
