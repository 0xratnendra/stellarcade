//! Jackpot drip pool (experimental).
//!
//! A reserve pool funded by game fees drips `drip_rate_per_ledger` tokens per
//! ledger. Active players accrue weight from their wager volume in the current
//! window and claim a time-weighted, volume-proportional share of the elapsed
//! drip, capped by the available pool balance.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{Error, PlayerActivity, ACTIVITY_TTL_LEDGERS, SWEEP_TIMELOCK_LEDGERS};
use types::DataKey;

#[contract]
pub struct JackpotDrip;

#[contractimpl]
impl JackpotDrip {
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        drip_rate_per_ledger: i128,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if drip_rate_per_ledger <= 0 {
            return Err(Error::InvalidDripRate);
        }
        if token == env.current_contract_address() {
            return Err(Error::InvalidAmount);
        }
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_drip_rate(&env, drip_rate_per_ledger);
        storage::set_last_drip_ledger(&env, env.ledger().sequence());
        Ok(())
    }

    /// Fund the drip reserve by transferring `amount` from `funder`.
    pub fn fund_drip_pool(env: Env, funder: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        funder.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&funder, &contract, &amount);
        storage::add_pool_balance(&env, amount);
        Ok(())
    }

    /// Record wager volume for a player, growing their drip weight.
    pub fn record_player_activity(env: Env, player: Address, volume: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        player.require_auth();
        if volume <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut activity = storage::get_activity(&env, &player);
        activity.volume += volume;
        activity.last_active_ledger = env.ledger().sequence();
        storage::set_activity(&env, &player, &activity);
        storage::add_active_player(&env, &player);
        Ok(())
    }

    /// Total drip weight: each player's activity volume, summed. Reads every
    /// recorded player via the activity index maintained by
    /// `record_player_activity`; acceptable for the experimental scale.
    pub fn total_weight(env: Env) -> i128 {
        let players = storage::all_active_players(&env);
        let mut total: i128 = 0;
        for player in players.iter() {
            total += storage::get_activity(&env, &player).volume;
        }
        total
    }

    /// Claim the player's accrued drip: proportional to their share of total
    /// activity weight, over the ledgers elapsed since their last claim,
    /// never exceeding the available pool balance. Zero-activity players get
    /// exactly zero tokens.
    pub fn claim_drip(env: Env, player: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let activity = storage::get_activity(&env, &player);
        if activity.volume <= 0 {
            return Ok(0);
        }

        let claimed_through = storage::get_claimed_through(&env, &player);
        let now = env.ledger().sequence();
        if now <= claimed_through {
            return Ok(0);
        }
        let elapsed = (now - claimed_through) as i128;

        let total = Self::total_weight(env.clone());
        if total <= 0 {
            return Ok(0);
        }

        // Time-weighted drip since the player's last claim, split by volume
        // share; capped by what the pool actually holds (#1241 invariant).
        let rate = storage::get_drip_rate(&env);
        let gross = rate.saturating_mul(elapsed);
        let share = gross.saturating_mul(activity.volume) / total;
        let pool = storage::get_pool_balance(&env);
        let payout = share.min(pool);
        if payout <= 0 {
            return Ok(0);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&contract, &player, &payout);
        storage::set_pool_balance(&env, pool - payout);
        storage::set_claimed_through(&env, &player, now);

        Ok(payout)
    }

    /// Emergency sweep: admin schedules draining the pool to `recipient`.
    /// The sweep only becomes executable after the timelock window.
    pub fn request_emergency_sweep(env: Env, admin: Address, recipient: Address) -> Result<u32, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        let eligible_at = env.ledger().sequence() + SWEEP_TIMELOCK_LEDGERS;
        storage::set_sweep_request(&env, &recipient, eligible_at);
        Ok(eligible_at)
    }

    /// Execute a requested sweep once its timelock has elapsed. Cancelling is
    /// implicit: a fresh `request_emergency_sweep` overwrites the pending one.
    pub fn execute_emergency_sweep(env: Env, admin: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        let (recipient, eligible_at) =
            storage::get_sweep_request(&env).ok_or(Error::SweepNotRequested)?;
        if env.ledger().sequence() < eligible_at {
            return Err(Error::SweepTimelockActive);
        }

        let balance = storage::get_pool_balance(&env);
        if balance <= 0 {
            return Err(Error::InsufficientPool);
        }

        let token = storage::get_token(&env);
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&contract, &recipient, &balance);
        storage::set_pool_balance(&env, 0);
        storage::clear_sweep_request(&env);
        Ok(balance)
    }

    /// Views
    pub fn get_pool_balance(env: Env) -> i128 {
        storage::get_pool_balance(&env)
    }

    pub fn get_drip_rate(env: Env) -> i128 {
        storage::get_drip_rate(&env)
    }

    pub fn get_player_activity(env: Env, player: Address) -> PlayerActivity {
        storage::get_activity(&env, &player)
    }
}
