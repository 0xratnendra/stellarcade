//! Milestone Escrow
//!
//! A progressive player milestone reward vault. Sponsors deposit a prize
//! pool; the admin configures a reward amount per milestone id (e.g. "10
//! wins" -> 10 XLM, "50 wins" -> 50 XLM); an authorized oracle verifies that
//! a specific player has completed a specific milestone; and the player
//! then claims the configured reward exactly once per milestone.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, oracle, token, pool balance, and per-milestone
//!   reward configuration. Small config shared across the contract's
//!   lifetime.
//! - `persistent()`: `Verified(player, milestone_id)` and
//!   `Claimed(player, milestone_id)` — one entry per player/milestone pair,
//!   bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Only the configured oracle may verify a milestone as complete.
//! - A milestone must be verified before it can be claimed.
//! - A given `(player, milestone_id)` pair can be claimed at most once.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::Error;
use types::{MilestoneConfigured, MilestoneVerified, PoolDeposited, RewardClaimed};

#[contract]
pub struct MilestoneEscrow;

#[contractimpl]
impl MilestoneEscrow {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        oracle: Address,
        token: Address,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        storage::set_admin(&env, &admin);
        storage::set_oracle(&env, &oracle);
        storage::set_token(&env, &token);
        storage::set_pool(&env, 0);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // configure_milestone
    // -----------------------------------------------------------------------

    /// Admin-only: set (or update) the reward amount for `milestone_id`.
    /// E.g. `configure_milestone(admin, 10, 10_0000000)` for a "10 wins"
    /// tier paying 10 XLM (in stroops).
    pub fn configure_milestone(
        env: Env,
        admin: Address,
        milestone_id: u64,
        reward: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if reward <= 0 {
            return Err(Error::InvalidInput);
        }

        storage::set_milestone_reward(&env, milestone_id, reward);

        MilestoneConfigured {
            milestone_id,
            reward,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit_pool
    // -----------------------------------------------------------------------

    /// Deposit `amount` of the configured token into the shared prize pool.
    /// Any address may sponsor the pool.
    pub fn deposit_pool(env: Env, sponsor: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        sponsor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&sponsor, &contract_address, &amount);

        let pool = storage::get_pool(&env)
            .checked_add(amount)
            .ok_or(Error::InvalidInput)?;
        storage::set_pool(&env, pool);

        PoolDeposited { sponsor, amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // verify_milestone
    // -----------------------------------------------------------------------

    /// Oracle-only: attest that `player` has completed `milestone_id`.
    /// Idempotent — verifying an already-verified milestone is a no-op
    /// (does not error), since the oracle re-submitting the same
    /// attestation should not be treated as a failure.
    pub fn verify_milestone(
        env: Env,
        oracle: Address,
        player: Address,
        milestone_id: u64,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        oracle.require_auth();

        if oracle != storage::get_oracle(&env) {
            return Err(Error::NotOracle);
        }
        if storage::get_milestone_reward(&env, milestone_id).is_none() {
            return Err(Error::MilestoneNotConfigured);
        }

        if !storage::is_verified(&env, &player, milestone_id) {
            storage::set_verified(&env, &player, milestone_id);
            MilestoneVerified {
                player,
                milestone_id,
            }
            .publish(&env);
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_reward
    // -----------------------------------------------------------------------

    /// Claim the configured reward for a verified milestone. Requires the
    /// milestone to have been verified by the oracle first, and can only be
    /// claimed once per `(player, milestone_id)` pair.
    pub fn claim_reward(env: Env, player: Address, milestone_id: u64) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        if !storage::is_verified(&env, &player, milestone_id) {
            return Err(Error::MilestoneNotVerified);
        }
        if storage::is_claimed(&env, &player, milestone_id) {
            return Err(Error::AlreadyClaimed);
        }

        let reward = storage::get_milestone_reward(&env, milestone_id)
            .ok_or(Error::MilestoneNotConfigured)?;

        let pool = storage::get_pool(&env);
        if reward > pool {
            return Err(Error::InsufficientPool);
        }

        storage::set_claimed(&env, &player, milestone_id);
        storage::set_pool(&env, pool - reward);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &player, &reward);

        RewardClaimed {
            player,
            milestone_id,
            amount: reward,
        }
        .publish(&env);

        Ok(reward)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Return the current prize pool balance.
    pub fn get_pool_balance(env: Env) -> i128 {
        storage::get_pool(&env)
    }

    /// Return whether `(player, milestone_id)` has been verified.
    pub fn is_milestone_verified(env: Env, player: Address, milestone_id: u64) -> bool {
        storage::is_verified(&env, &player, milestone_id)
    }

    /// Return whether `(player, milestone_id)` has already been claimed.
    pub fn is_milestone_claimed(env: Env, player: Address, milestone_id: u64) -> bool {
        storage::is_claimed(&env, &player, milestone_id)
    }
}
