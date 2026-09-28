//! Soulbound achievement badge (experimental).
//!
//! Admin-minted, non-transferable badges bound permanently to a player
//! address, representing arcade achievements and rank badges. Badges can
//! never move between wallets — the `transfer` entry point always errors —
//! the only way to remove one is for its own owner to `burn` it.
//!
//! ## Storage Strategy
//! - `instance()`: admin, collection name, and symbol.
//! - `persistent()`: `Badge(owner, badge_id)`.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Only the admin may mint badges.
//! - `transfer` always fails with `NotTransferable`.
//! - A given `(owner, badge_id)` pair can only be minted once; burning
//!   frees it up again.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

pub use types::{BadgeInfo, Error};

#[contract]
pub struct BadgeSoulboundNft;

#[contractimpl]
impl BadgeSoulboundNft {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Bootstrap the badge collection. May only be called once.
    pub fn initialize(env: Env, admin: Address, name: String, symbol: String) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_name(&env, &name);
        storage::set_symbol(&env, &symbol);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // mint
    // -----------------------------------------------------------------------

    /// Mint `badge_id` to `to`, binding it permanently to that address.
    /// Only the configured admin may mint. Fails if `to` already holds
    /// `badge_id`.
    pub fn mint(
        env: Env,
        admin: Address,
        to: Address,
        badge_id: u64,
        uri: String,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        if storage::has_badge(&env, &to, badge_id) {
            return Err(Error::BadgeAlreadyMinted);
        }

        storage::set_badge(
            &env,
            &to,
            badge_id,
            &BadgeInfo {
                metadata_uri: uri,
                minted_at_ledger: env.ledger().sequence(),
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // transfer (always rejected — soulbound enforcement)
    // -----------------------------------------------------------------------

    /// Soulbound enforcement: transfer attempts always fail. Badges cannot
    /// leave the wallet they were minted to.
    pub fn transfer(_env: Env, _from: Address, _to: Address, _badge_id: u64) -> Result<(), Error> {
        Err(Error::NotTransferable)
    }

    // -----------------------------------------------------------------------
    // has_badge
    // -----------------------------------------------------------------------

    /// Whether `player` currently holds `badge_id`. Used by other
    /// contracts for platform gatekeeping.
    pub fn has_badge(env: Env, player: Address, badge_id: u64) -> bool {
        storage::has_badge(&env, &player, badge_id)
    }

    // -----------------------------------------------------------------------
    // burn
    // -----------------------------------------------------------------------

    /// Discard a badge. Only its current owner may burn it.
    pub fn burn(env: Env, owner: Address, badge_id: u64) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        owner.require_auth();
        if !storage::has_badge(&env, &owner, badge_id) {
            return Err(Error::BadgeNotFound);
        }
        storage::remove_badge(&env, &owner, badge_id);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Read-only metadata for a badge.
    pub fn get_badge(env: Env, owner: Address, badge_id: u64) -> Result<BadgeInfo, Error> {
        storage::load_badge(&env, &owner, badge_id)
    }
}
