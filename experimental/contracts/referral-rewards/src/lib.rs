//! Referral Rewards
//!
//! On-chain player referral tracking with tiered rebate escrow. A player
//! permanently binds a referrer once; authorized game contracts report
//! wager fee volume for that player, and a share of it (scaling with the
//! referrer's total active-referral count) accrues to the referrer as a
//! claimable rebate.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, tier schedule, and the authorized-caller
//!   allowlist. Small, shared config.
//! - `persistent()`: `Referrer(player)`, `ReferralCount(referrer)`, and
//!   `Claimable(referrer)`, each bumped on every write.
//!
//! ## Invariants
//! - `register_referrer` is one-time and immutable: once a player has a
//!   bound referrer, it can never be changed.
//! - A player cannot refer themselves.
//! - A player cannot bind to a referrer whose OWN referrer is that same
//!   player (the only circular shape possible under a one-referrer-per-
//!   player model: A -> B -> A).
//! - Only an authorized caller contract may call `record_wager_fee`, so an
//!   arbitrary caller cannot fabricate fee volume to inflate a referrer's
//!   earnings.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub use types::{Error, RewardTier};
use types::{ReferralEarningsClaimed, ReferrerRegistered, WagerFeeRecorded, BPS_DENOMINATOR};

#[contract]
pub struct ReferralRewards;

#[contractimpl]
impl ReferralRewards {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. `tiers` must be sorted ascending by
    /// `min_referrals`, with the first tier's `min_referrals == 0` (every
    /// referrer earns at least the base tier).
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        tiers: Vec<RewardTier>,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        validate_tiers(&tiers)?;

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_tiers(&env, &tiers);
        storage::set_authorized_callers(&env, &Vec::new(&env));

        Ok(())
    }

    // -----------------------------------------------------------------------
    // authorize_caller
    // -----------------------------------------------------------------------

    /// Admin-only: authorize `caller_contract` to report wager fee volume
    /// via `record_wager_fee`.
    pub fn authorize_caller(
        env: Env,
        admin: Address,
        caller_contract: Address,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }

        let mut callers = storage::get_authorized_callers(&env);
        if !callers.iter().any(|c| c == caller_contract) {
            callers.push_back(caller_contract);
            storage::set_authorized_callers(&env, &callers);
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // register_referrer
    // -----------------------------------------------------------------------

    /// Bind `player` to `referrer`, permanently. May only be called once
    /// per player. Rejects self-referral and the one circular shape
    /// possible under a one-referrer-per-player model (referrer's own
    /// referrer being `player`).
    pub fn register_referrer(env: Env, player: Address, referrer: Address) -> Result<(), Error> {
        player.require_auth();

        if player == referrer {
            return Err(Error::SelfReferralNotAllowed);
        }
        if storage::get_referrer(&env, &player).is_some() {
            return Err(Error::ReferrerAlreadySet);
        }
        if let Some(referrers_referrer) = storage::get_referrer(&env, &referrer) {
            if referrers_referrer == player {
                return Err(Error::CircularReferralNotAllowed);
            }
        }

        storage::set_referrer(&env, &player, &referrer);
        let count = storage::get_referral_count(&env, &referrer) + 1;
        storage::set_referral_count(&env, &referrer, count);

        ReferrerRegistered { player, referrer }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // record_wager_fee
    // -----------------------------------------------------------------------

    /// Authorized-caller-only: report that `player` generated `fee_amount`
    /// of wager fee volume. If `player` has a bound referrer, accrues that
    /// referrer's tiered reward share (based on the referrer's CURRENT
    /// active-referral count at the time of this call) to their claimable
    /// balance. A no-op (not an error) if `player` has no referrer, since
    /// most players won't.
    pub fn record_wager_fee(
        env: Env,
        caller_contract: Address,
        player: Address,
        fee_amount: i128,
    ) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        caller_contract.require_auth();

        if !storage::get_authorized_callers(&env)
            .iter()
            .any(|c| c == caller_contract)
        {
            return Err(Error::NotAuthorizedCaller);
        }
        if fee_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let referrer = match storage::get_referrer(&env, &player) {
            Some(r) => r,
            None => return Ok(0),
        };

        let referral_count = storage::get_referral_count(&env, &referrer);
        let reward_bps = tier_reward_bps(&storage::get_tiers(&env), referral_count);

        let reward_amount = fee_amount
            .checked_mul(reward_bps as i128)
            .and_then(|v| v.checked_div(BPS_DENOMINATOR as i128))
            .ok_or(Error::InvalidInput)?;

        if reward_amount > 0 {
            let existing = storage::get_claimable(&env, &referrer);
            storage::set_claimable(&env, &referrer, existing + reward_amount);
        }

        WagerFeeRecorded {
            player,
            referrer,
            fee_amount,
            reward_amount,
        }
        .publish(&env);

        Ok(reward_amount)
    }

    // -----------------------------------------------------------------------
    // claim_referral_earnings
    // -----------------------------------------------------------------------

    /// Claim a referrer's full accumulated, unclaimed reward balance.
    pub fn claim_referral_earnings(env: Env, referrer: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        referrer.require_auth();

        let amount = storage::get_claimable(&env, &referrer);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }

        storage::set_claimable(&env, &referrer, 0);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &referrer, &amount);

        ReferralEarningsClaimed { referrer, amount }.publish(&env);

        Ok(amount)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_referrer_of(env: Env, player: Address) -> Option<Address> {
        storage::get_referrer(&env, &player)
    }

    pub fn get_referral_count(env: Env, referrer: Address) -> u32 {
        storage::get_referral_count(&env, &referrer)
    }

    pub fn get_claimable(env: Env, referrer: Address) -> i128 {
        storage::get_claimable(&env, &referrer)
    }
}

fn validate_tiers(tiers: &Vec<RewardTier>) -> Result<(), Error> {
    if tiers.is_empty() {
        return Err(Error::InvalidTiers);
    }
    let first = tiers.get(0).unwrap();
    if first.min_referrals != 0 {
        return Err(Error::InvalidTiers);
    }

    let mut prev_min = 0u32;
    for (i, tier) in tiers.iter().enumerate() {
        if i > 0 && tier.min_referrals <= prev_min {
            return Err(Error::InvalidTiers);
        }
        if tier.reward_bps > BPS_DENOMINATOR {
            return Err(Error::InvalidTiers);
        }
        prev_min = tier.min_referrals;
    }

    Ok(())
}

/// Return the reward bps for the highest tier `referral_count` qualifies
/// for. Tiers are validated at `initialize`/never-mutated-after-that time
/// to always include a `min_referrals == 0` base tier, so this always
/// returns a value (never needs a fallback).
fn tier_reward_bps(tiers: &Vec<RewardTier>, referral_count: u32) -> u32 {
    let mut result = 0u32;
    for tier in tiers.iter() {
        if referral_count >= tier.min_referrals {
            result = tier.reward_bps;
        }
    }
    result
}
