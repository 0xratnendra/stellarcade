//! Bounty Escrow
//!
//! A community arcade bounty and speedrun escrow. Sponsors post a bounty
//! (a prize pool tied to a target game and score, with tiered partial
//! payouts), players submit a proof-of-achievement claim, and a designated
//! verifier approves the claim to release the tier's payout. Unclaimed
//! bounties can be refunded to their sponsor once expired.
//!
//! ## Storage Strategy
//! - `instance()`: Token, bounty counter. Small, shared config.
//! - `persistent()`: `Bounty(id)` and `Claim(id)`, each bumped on every
//!   write.
//!
//! ## Invariants
//! - A bounty's tiers must be sorted ascending by score threshold, with
//!   non-decreasing cumulative `payout_bps`, and the top tier must pay out
//!   exactly `BPS_DENOMINATOR` (100%).
//! - Only the bounty's designated verifier may approve a claim.
//! - A tier already paid cannot be paid again (prevents double payout for
//!   the same or a lower-scoring re-submission).
//! - A bounty cannot be approved after its sponsor has reclaimed expired
//!   funds via `refund_expired`.
//! - `refund_expired` only returns the UNPAID remainder (`amount -
//!   paid_out`), never funds already sent to a player for an earlier
//!   approved tier.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, Symbol, Vec};

pub use types::{Bounty, BountyTier, Claim, Error};
use types::{BountyApproved, BountyPosted, BountyRefunded, ClaimSubmitted, BPS_DENOMINATOR};

#[contract]
pub struct BountyEscrow;

#[contractimpl]
impl BountyEscrow {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, token: Address) {
        storage::set_token(&env, &token);
    }

    // -----------------------------------------------------------------------
    // post_bounty
    // -----------------------------------------------------------------------

    /// Post a new bounty. `sponsor` deposits `amount` of the escrow token
    /// up front. `tiers` defines the tiered payout schedule (see module
    /// doc's invariants); returns the new bounty's id.
    pub fn post_bounty(
        env: Env,
        sponsor: Address,
        target_game: Symbol,
        amount: i128,
        deadline_ledger: u32,
        verifier: Address,
        tiers: Vec<BountyTier>,
    ) -> Result<u64, Error> {
        sponsor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        if deadline_ledger <= env.ledger().sequence() {
            return Err(Error::InvalidInput);
        }
        validate_tiers(&tiers)?;

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&sponsor, &contract_address, &amount);

        let id = storage::next_bounty_id(&env);
        let bounty = Bounty {
            id,
            sponsor,
            target_game,
            amount,
            paid_out: 0,
            highest_tier_paid: None,
            tiers,
            deadline_ledger,
            verifier,
            refunded: false,
        };
        storage::set_bounty(&env, &bounty);

        BountyPosted {
            bounty_id: id,
            sponsor: bounty.sponsor,
            amount,
            deadline_ledger,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // submit_claim
    // -----------------------------------------------------------------------

    /// Submit a claim of achievement for `bounty_id`, with `claimed_score`
    /// and an off-chain proof hash (e.g. a hash of the recorded game
    /// session) for the verifier to check out-of-band before approving.
    /// Overwrites any previous unapproved claim for this bounty.
    pub fn submit_claim(
        env: Env,
        player: Address,
        bounty_id: u64,
        proof_hash: BytesN<32>,
        claimed_score: u32,
    ) -> Result<(), Error> {
        player.require_auth();

        let bounty = storage::get_bounty(&env, bounty_id)?;
        if bounty.refunded {
            return Err(Error::BountyExpired);
        }
        if env.ledger().sequence() >= bounty.deadline_ledger {
            return Err(Error::BountyExpired);
        }

        storage::set_claim(
            &env,
            bounty_id,
            &Claim {
                player: player.clone(),
                proof_hash,
                claimed_score,
            },
        );

        ClaimSubmitted {
            bounty_id,
            player,
            claimed_score,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // approve_bounty
    // -----------------------------------------------------------------------

    /// Verifier-only: approve the currently submitted claim for
    /// `bounty_id`, paying out the highest tier the claimed score unlocks
    /// that hasn't already been paid. Pays only the INCREMENTAL share
    /// between the previously paid tier and the newly unlocked one, so
    /// approving successive higher-scoring claims over time pays out each
    /// tier's marginal share exactly once.
    pub fn approve_bounty(env: Env, verifier: Address, bounty_id: u64) -> Result<i128, Error> {
        verifier.require_auth();

        let mut bounty = storage::get_bounty(&env, bounty_id)?;
        if verifier != bounty.verifier {
            return Err(Error::NotAuthorizedVerifier);
        }
        if bounty.refunded {
            return Err(Error::BountyExpired);
        }

        let claim = storage::get_claim(&env, bounty_id).ok_or(Error::NoClaimSubmitted)?;

        let unlocked_tier_index = find_unlocked_tier(&bounty.tiers, claim.claimed_score)
            .ok_or(Error::ScoreBelowLowestTier)?;

        if let Some(paid) = bounty.highest_tier_paid {
            if unlocked_tier_index <= paid {
                return Err(Error::TierAlreadyPaid);
            }
        }

        let unlocked_tier = bounty
            .tiers
            .get(unlocked_tier_index)
            .ok_or(Error::InvalidTiers)?;
        let target_paid = bounty
            .amount
            .checked_mul(unlocked_tier.payout_bps as i128)
            .and_then(|v| v.checked_div(BPS_DENOMINATOR as i128))
            .ok_or(Error::InvalidInput)?;
        let payout = target_paid - bounty.paid_out;

        bounty.paid_out = target_paid;
        bounty.highest_tier_paid = Some(unlocked_tier_index);
        storage::set_bounty(&env, &bounty);
        storage::clear_claim(&env, bounty_id);

        if payout > 0 {
            let token_client = token::Client::new(&env, &storage::get_token(&env));
            let contract_address = env.current_contract_address();
            token_client.transfer(&contract_address, &claim.player, &payout);
        }

        BountyApproved {
            bounty_id,
            player: claim.player,
            amount_paid: payout,
            tier_index: unlocked_tier_index,
        }
        .publish(&env);

        Ok(payout)
    }

    // -----------------------------------------------------------------------
    // refund_expired
    // -----------------------------------------------------------------------

    /// Sponsor-only: reclaim the unpaid remainder of an expired bounty.
    /// Callable once per bounty; only returns `amount - paid_out`, never
    /// funds already sent to a player for an earlier approved tier.
    pub fn refund_expired(env: Env, sponsor: Address, bounty_id: u64) -> Result<i128, Error> {
        sponsor.require_auth();

        let mut bounty = storage::get_bounty(&env, bounty_id)?;
        if sponsor != bounty.sponsor {
            return Err(Error::InvalidInput);
        }
        if env.ledger().sequence() < bounty.deadline_ledger {
            return Err(Error::BountyNotExpired);
        }
        if bounty.refunded {
            return Err(Error::AlreadyRefunded);
        }

        let refund_amount = bounty.amount - bounty.paid_out;
        bounty.refunded = true;
        storage::set_bounty(&env, &bounty);

        if refund_amount > 0 {
            let token_client = token::Client::new(&env, &storage::get_token(&env));
            let contract_address = env.current_contract_address();
            token_client.transfer(&contract_address, &sponsor, &refund_amount);
        }

        BountyRefunded {
            bounty_id,
            sponsor,
            amount: refund_amount,
        }
        .publish(&env);

        Ok(refund_amount)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_bounty(env: Env, bounty_id: u64) -> Result<Bounty, Error> {
        storage::get_bounty(&env, bounty_id)
    }

    pub fn get_claim(env: Env, bounty_id: u64) -> Option<Claim> {
        storage::get_claim(&env, bounty_id)
    }
}

fn validate_tiers(tiers: &Vec<BountyTier>) -> Result<(), Error> {
    if tiers.is_empty() {
        return Err(Error::InvalidTiers);
    }

    let mut prev_score = 0u32;
    let mut prev_bps = 0u32;
    for (i, tier) in tiers.iter().enumerate() {
        if i > 0 && tier.score_threshold <= prev_score {
            return Err(Error::InvalidTiers);
        }
        if tier.payout_bps < prev_bps || tier.payout_bps > BPS_DENOMINATOR {
            return Err(Error::InvalidTiers);
        }
        prev_score = tier.score_threshold;
        prev_bps = tier.payout_bps;
    }

    if prev_bps != BPS_DENOMINATOR {
        return Err(Error::InvalidTiers);
    }

    Ok(())
}

/// Return the index of the highest tier whose `score_threshold` is met by
/// `score`, or `None` if `score` doesn't reach even the lowest tier.
fn find_unlocked_tier(tiers: &Vec<BountyTier>, score: u32) -> Option<u32> {
    let mut result = None;
    for (i, tier) in tiers.iter().enumerate() {
        if score >= tier.score_threshold {
            result = Some(i as u32);
        }
    }
    result
}
