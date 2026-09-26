//! Subscription Pass
//!
//! A recurring arcade season subscription pass. Players prepay a fixed
//! `pass_cost` in the configured SEP-41 token to activate or renew a
//! membership window measured in ledgers; the admin can configure VIP tiers
//! that grant bonus duration on top of the base window.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, pass cost, base duration, and per-tier
//!   bonus-ledger configuration. Small config shared across the contract's
//!   lifetime.
//! - `persistent()`: `PassRecord` per player address, bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - `is_pass_active` returns `false` once the current ledger has passed the
//!   stored `expiry_ledger` (strict: a pass expiring exactly at the current
//!   ledger is no longer active).
//! - Renewing a pass extends from the greater of "now" and the pass's
//!   current expiry, so renewing early does not forfeit remaining time and
//!   renewing late does not backdate the new window.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::Error;
use types::{PassPurchased, PassRecord, PassRenewed, TierConfigured};

#[contract]
pub struct SubscriptionPass;

#[contractimpl]
impl SubscriptionPass {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    ///
    /// `pass_cost` is charged (in `token`) on every purchase or renewal;
    /// `duration_ledgers` is the base membership window length granted per
    /// purchase/renewal, before any VIP tier bonus.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        pass_cost: i128,
        duration_ledgers: u32,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        if pass_cost <= 0 || duration_ledgers == 0 {
            return Err(Error::InvalidInput);
        }

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_pass_cost(&env, pass_cost);
        storage::set_duration_ledgers(&env, duration_ledgers);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // buy_pass
    // -----------------------------------------------------------------------

    /// Purchase a fresh season pass, activating (or replacing) the player's
    /// membership window. Charges `pass_cost` in the configured token.
    ///
    /// If the player already holds a pass (active or expired), this starts a
    /// brand-new window from the current ledger rather than stacking on top
    /// of any remaining time — use `renew_pass` to extend an existing
    /// membership without losing unused time.
    pub fn buy_pass(env: Env, player: Address) -> Result<PassRecord, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let cost = storage::get_pass_cost(&env);
        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &cost);

        let tier = storage::get_pass(&env, &player)
            .map(|p| p.tier)
            .unwrap_or(0);
        let window = storage::get_duration_ledgers(&env) + storage::get_tier_bonus(&env, tier);
        let expiry_ledger = env.ledger().sequence() + window;

        let pass = PassRecord {
            player: player.clone(),
            expiry_ledger,
            tier,
        };
        storage::set_pass(&env, &pass);

        PassPurchased {
            player,
            expiry_ledger,
            tier,
        }
        .publish(&env);

        Ok(pass)
    }

    // -----------------------------------------------------------------------
    // renew_pass
    // -----------------------------------------------------------------------

    /// Renew an existing pass, extending the membership window. Charges
    /// `pass_cost` again. Extends from the later of "now" and the pass's
    /// current expiry, so renewing before expiry preserves remaining time.
    pub fn renew_pass(env: Env, player: Address) -> Result<PassRecord, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let mut pass = storage::get_pass(&env, &player).ok_or(Error::NoActivePass)?;

        let cost = storage::get_pass_cost(&env);
        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &cost);

        let now = env.ledger().sequence();
        let window = storage::get_duration_ledgers(&env) + storage::get_tier_bonus(&env, pass.tier);
        let base = if pass.expiry_ledger > now {
            pass.expiry_ledger
        } else {
            now
        };
        pass.expiry_ledger = base + window;
        storage::set_pass(&env, &pass);

        PassRenewed {
            player,
            expiry_ledger: pass.expiry_ledger,
        }
        .publish(&env);

        Ok(pass)
    }

    // -----------------------------------------------------------------------
    // is_pass_active
    // -----------------------------------------------------------------------

    /// Return whether `player` currently holds an active (non-expired) pass.
    /// Returns `false` for a player who has never purchased a pass.
    pub fn is_pass_active(env: Env, player: Address) -> bool {
        match storage::get_pass(&env, &player) {
            Some(pass) => env.ledger().sequence() < pass.expiry_ledger,
            None => false,
        }
    }

    // -----------------------------------------------------------------------
    // get_pass_details
    // -----------------------------------------------------------------------

    /// Return `player`'s current pass record.
    pub fn get_pass_details(env: Env, player: Address) -> Result<PassRecord, Error> {
        storage::get_pass(&env, &player).ok_or(Error::NoActivePass)
    }

    // -----------------------------------------------------------------------
    // admin_set_tier
    // -----------------------------------------------------------------------

    /// Admin-only: upgrade (or downgrade) `player`'s VIP tier. Takes effect
    /// on the player's next purchase or renewal; does not itself extend an
    /// already-active window.
    pub fn admin_set_tier(
        env: Env,
        admin: Address,
        player: Address,
        tier: u32,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }

        let mut pass = storage::get_pass(&env, &player).unwrap_or(PassRecord {
            player: player.clone(),
            expiry_ledger: env.ledger().sequence(),
            tier: 0,
        });
        pass.tier = tier;
        storage::set_pass(&env, &pass);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // admin_configure_tier
    // -----------------------------------------------------------------------

    /// Admin-only: configure the bonus duration (in ledgers) that `tier`
    /// grants on top of the base `duration_ledgers` for every
    /// purchase/renewal made at that tier. Tier `0` is the base tier and
    /// always grants zero bonus.
    pub fn admin_configure_tier(
        env: Env,
        admin: Address,
        tier: u32,
        bonus_ledgers: u32,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if tier == 0 {
            return Err(Error::InvalidTier);
        }

        storage::set_tier_bonus(&env, tier, bonus_ledgers);

        TierConfigured {
            tier,
            bonus_ledgers,
        }
        .publish(&env);

        Ok(())
    }
}
