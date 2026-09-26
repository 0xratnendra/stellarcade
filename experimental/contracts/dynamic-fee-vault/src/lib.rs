//! Dynamic fee vault (experimental).
//!
//! Tracks each player's rolling 30-day wager volume and discounts the arcade
//! rake by tier: Base 2.00% → Bronze 1.50% → Silver 1.00% → Gold 0.50%, never
//! below the 0.25% floor. Collected net house fees accumulate in the vault for
//! admin withdrawal.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{
    Error, PlayerVolume, MIN_FEE_BPS, TIER_FEES_BPS, TIER_THRESHOLDS, WINDOW_LEDGERS,
};
use types::DataKey;

#[contract]
pub struct DynamicFeeVault;

#[contractimpl]
impl DynamicFeeVault {
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if token == env.current_contract_address() {
            return Err(Error::InvalidAmount);
        }
        storage::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        Ok(())
    }

    /// Record wager volume for a player. Volume accumulates within a rolling
    /// `WINDOW_LEDGERS` window; older windows reset to zero before adding.
    pub fn record_volume(env: Env, player: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        player.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut volume = storage::load_player_volume(&env, &player);
        volume.total_volume += amount;
        storage::save_player_volume(&env, &player, &volume);
        Ok(())
    }

    /// Effective fee in basis points for a player's next wager, derived from
    /// their current rolling volume. Always ≥ `MIN_FEE_BPS`.
    pub fn get_fee_bps_for_player(env: Env, player: Address) -> u32 {
        let volume = storage::load_player_volume(&env, &player);
        fee_bps_for_volume(volume.total_volume)
    }

    /// Charge `fee_amount` into the vault on behalf of a game host. The
    /// caller authorizes the token transfer of the fee into this contract.
    pub fn collect_fee(env: Env, from: Address, fee_amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        from.require_auth();
        if fee_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&from, &contract, &fee_amount);
        storage::add_fees_collected(&env, fee_amount);
        Ok(())
    }

    /// Withdraw accumulated net house fees. Admin-only.
    pub fn withdraw_fees(env: Env, admin: Address, recipient: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }

        let amount = storage::get_fees_collected(&env);
        if amount <= 0 {
            return Err(Error::InsufficientFees);
        }

        let token = storage::get_token(&env);
        token::Client::new(&env, &token).transfer(&contract_addr(&env), &recipient, &amount);
        storage::set_fees_collected(&env, 0);
        Ok(amount)
    }

    /// View: a player's current rolling-window volume.
    pub fn get_player_volume(env: Env, player: Address) -> PlayerVolume {
        storage::load_player_volume(&env, &player)
    }

    /// View: fees currently held by the vault.
    pub fn get_fees_collected(env: Env) -> i128 {
        storage::get_fees_collected(&env)
    }
}

/// Tier lookup shared by the fee getter and tests.
pub fn fee_bps_for_volume(volume: i128) -> u32 {
    let mut tier = 0usize;
    for (idx, threshold) in TIER_THRESHOLDS.iter().enumerate() {
        if volume >= *threshold {
            tier = idx + 1;
        }
    }
    let bps = TIER_FEES_BPS[tier];
    if bps < MIN_FEE_BPS {
        MIN_FEE_BPS
    } else {
        bps
    }
}

fn contract_addr(env: &Env) -> Address {
    env.current_contract_address()
}
