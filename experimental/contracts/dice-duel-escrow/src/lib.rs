//! Dice Duel Escrow
//!
//! A peer-to-peer 1v1 dice duel. A creator invites a specific opponent and
//! locks a wager; the opponent accepts, matching it; both players commit
//! to a hidden dice roll, then reveal it; the higher roll sweeps the pot,
//! and an unresolved tie splits it evenly.
//!
//! ## Commit-reveal
//!
//! Each player first calls `commit_roll` with `sha256(secret ||
//! player_address)` — binding the commitment to the specific committing
//! player's own address, not just the secret, so the SECOND committer
//! cannot simply copy the first committer's on-chain commitment hash
//! verbatim and later reveal the same secret to force a tie (their own
//! commitment would need `their_own_address` baked in, which a copied
//! hash wouldn't produce — `roll_dice`'s hash check would then fail for
//! them, not the honest first committer). Once both have committed
//! (locking in their choice before either has seen the other's), each
//! reveals via `roll_dice(player, duel_id, secret)`, which verifies the
//! secret hashes back to that player's own stored commitment and derives
//! their die value as `sha256(secret) % sides + 1`.
//!
//! ## Storage Strategy
//! - `instance()`: a single duel counter.
//! - `persistent()`: `Duel(id)`, bumped on every write.
//!
//! ## State machine
//! `Pending` -[accept]-> `Committing` -[both commit]-> `Revealing`
//! -[both reveal, unequal]-> `Settled` (swept to the higher roller).
//! `Revealing` -[both reveal, equal]-> `Tied` -[settle_duel]-> `Settled`
//! (pot split evenly). `Pending` -[cancel, opponent hasn't joined]->
//! `Settled` (refunded to creator).
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, Bytes, BytesN, Env};

pub use types::{DiceSides, Duel, DuelStatus, Error};
use types::{DuelAccepted, DuelCancelled, DuelCreated, DuelSettled, RollCommitted, RollRevealed};

#[contract]
pub struct DiceDuelEscrow;

#[contractimpl]
impl DiceDuelEscrow {
    // -----------------------------------------------------------------------
    // create_duel
    // -----------------------------------------------------------------------

    pub fn create_duel(
        env: Env,
        creator: Address,
        opponent: Address,
        token: Address,
        wager: i128,
        dice: DiceSides,
    ) -> Result<u64, Error> {
        creator.require_auth();

        if creator == opponent {
            return Err(Error::InvalidInput);
        }
        if wager <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&creator, &contract_address, &wager);

        let id = storage::next_duel_id(&env);
        let duel = Duel {
            id,
            creator: creator.clone(),
            opponent: opponent.clone(),
            token,
            wager,
            dice,
            status: DuelStatus::Pending,
            creator_commitment: None,
            opponent_commitment: None,
            creator_roll: None,
            opponent_roll: None,
        };
        storage::set_duel(&env, &duel);

        DuelCreated {
            duel_id: id,
            creator,
            opponent,
            wager,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // accept_duel
    // -----------------------------------------------------------------------

    /// The designated opponent accepts, matching the wager. Only the
    /// exact address named as `opponent` in `create_duel` may accept —
    /// nobody else can hijack the invitation.
    pub fn accept_duel(env: Env, opponent: Address, duel_id: u64) -> Result<(), Error> {
        opponent.require_auth();

        let mut duel = storage::get_duel(&env, duel_id)?;
        if duel.status != DuelStatus::Pending {
            return Err(Error::WrongDuelState);
        }
        if opponent != duel.opponent {
            return Err(Error::NotThePendingOpponent);
        }

        let token_client = token::Client::new(&env, &duel.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&opponent, &contract_address, &duel.wager);

        duel.status = DuelStatus::Committing;
        storage::set_duel(&env, &duel);

        DuelAccepted { duel_id }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // cancel_duel
    // -----------------------------------------------------------------------

    /// The creator cancels and reclaims their wager before the opponent
    /// has joined.
    pub fn cancel_duel(env: Env, creator: Address, duel_id: u64) -> Result<i128, Error> {
        creator.require_auth();

        let mut duel = storage::get_duel(&env, duel_id)?;
        if duel.status != DuelStatus::Pending {
            return Err(Error::WrongDuelState);
        }
        if creator != duel.creator {
            return Err(Error::NotAParticipant);
        }

        duel.status = DuelStatus::Settled;
        storage::set_duel(&env, &duel);

        let token_client = token::Client::new(&env, &duel.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &creator, &duel.wager);

        DuelCancelled { duel_id }.publish(&env);

        Ok(duel.wager)
    }

    // -----------------------------------------------------------------------
    // commit_roll
    // -----------------------------------------------------------------------

    /// Commit to a hidden roll. `commitment` must equal
    /// `sha256(secret || player_address_xdr)`, verified when the player
    /// later reveals via `roll_dice`.
    pub fn commit_roll(
        env: Env,
        player: Address,
        duel_id: u64,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let mut duel = storage::get_duel(&env, duel_id)?;
        if duel.status != DuelStatus::Committing {
            return Err(Error::WrongDuelState);
        }

        if player == duel.creator {
            if duel.creator_commitment.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            duel.creator_commitment = Some(commitment);
        } else if player == duel.opponent {
            if duel.opponent_commitment.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            duel.opponent_commitment = Some(commitment);
        } else {
            return Err(Error::NotAParticipant);
        }

        if duel.creator_commitment.is_some() && duel.opponent_commitment.is_some() {
            duel.status = DuelStatus::Revealing;
        }
        storage::set_duel(&env, &duel);

        RollCommitted { duel_id, player }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // roll_dice
    // -----------------------------------------------------------------------

    /// Reveal a previously committed roll. Verifies `sha256(secret ||
    /// player_address_xdr)` matches the player's own stored commitment,
    /// then derives their die value as `sha256(secret) % sides + 1`. Once
    /// both players have revealed, automatically resolves the duel:
    /// sweeps the pot to the higher roller, or moves to `Tied` (awaiting
    /// `settle_duel` to split the pot) on an equal roll.
    pub fn roll_dice(
        env: Env,
        player: Address,
        duel_id: u64,
        secret: BytesN<32>,
    ) -> Result<u32, Error> {
        player.require_auth();

        let mut duel = storage::get_duel(&env, duel_id)?;
        if duel.status != DuelStatus::Revealing {
            return Err(Error::WrongDuelState);
        }

        let is_creator = player == duel.creator;
        let is_opponent = player == duel.opponent;
        if !is_creator && !is_opponent {
            return Err(Error::NotAParticipant);
        }

        let commitment = if is_creator {
            duel.creator_commitment.clone()
        } else {
            duel.opponent_commitment.clone()
        }
        .ok_or(Error::NoCommitmentFound)?;

        let expected = commitment_hash(&env, &secret, &player);
        if expected != commitment {
            return Err(Error::CommitmentMismatch);
        }

        let value = roll_value(&env, &secret, duel.dice);

        if is_creator {
            duel.creator_roll = Some(value);
        } else {
            duel.opponent_roll = Some(value);
        }
        storage::set_duel(&env, &duel);

        RollRevealed {
            duel_id,
            player: player.clone(),
            value,
        }
        .publish(&env);

        if let (Some(creator_roll), Some(opponent_roll)) = (duel.creator_roll, duel.opponent_roll) {
            Self::resolve(&env, duel_id, creator_roll, opponent_roll)?;
        }

        Ok(value)
    }

    // -----------------------------------------------------------------------
    // settle_duel
    // -----------------------------------------------------------------------

    /// Split the pot evenly between both players once a tied duel has
    /// been left unresolved (no re-roll implemented in this contract: a
    /// tie's simplest, safest resolution is an even split, avoiding the
    /// added state-machine complexity of resetting commitments for a
    /// fresh round within the same duel id).
    pub fn settle_duel(env: Env, duel_id: u64) -> Result<i128, Error> {
        let mut duel = storage::get_duel(&env, duel_id)?;
        if duel.status != DuelStatus::Tied {
            return Err(Error::WrongDuelState);
        }

        duel.status = DuelStatus::Settled;
        storage::set_duel(&env, &duel);

        let half = duel.wager;
        let token_client = token::Client::new(&env, &duel.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &duel.creator, &half);
        token_client.transfer(&contract_address, &duel.opponent, &half);

        DuelSettled {
            duel_id,
            winner: None,
            payout: half,
        }
        .publish(&env);

        Ok(half)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_duel(env: Env, duel_id: u64) -> Result<Duel, Error> {
        storage::get_duel(&env, duel_id)
    }
}

impl DiceDuelEscrow {
    fn resolve(
        env: &Env,
        duel_id: u64,
        creator_roll: u32,
        opponent_roll: u32,
    ) -> Result<(), Error> {
        let mut duel = storage::get_duel(env, duel_id)?;

        if creator_roll == opponent_roll {
            duel.status = DuelStatus::Tied;
            storage::set_duel(env, &duel);
            return Ok(());
        }

        duel.status = DuelStatus::Settled;
        let pot = duel.wager * 2;
        let winner = if creator_roll > opponent_roll {
            duel.creator.clone()
        } else {
            duel.opponent.clone()
        };
        storage::set_duel(env, &duel);

        let token_client = token::Client::new(env, &duel.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &winner, &pot);

        DuelSettled {
            duel_id,
            winner: Some(winner),
            payout: pot,
        }
        .publish(env);

        Ok(())
    }
}

/// `sha256(secret || player_address_xdr)`, binding a commitment to the
/// specific committing player.
fn commitment_hash(env: &Env, secret: &BytesN<32>, player: &Address) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, &secret.to_array());
    preimage.append(&player.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

/// `sha256(secret) % sides + 1`, mapping the digest's low bytes onto a
/// `1..=sides` die value.
fn roll_value(env: &Env, secret: &BytesN<32>, dice: DiceSides) -> u32 {
    let digest: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &secret.to_array()))
        .into();
    let bytes = digest.to_array();
    let raw = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    raw % dice.sides() + 1
}
