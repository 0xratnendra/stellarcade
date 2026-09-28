//! Progressive Jackpot Vault
//!
//! An experimental Soroban contract aggregating micro-contributions from
//! a whitelist of authorized game contracts into a shared, growing
//! jackpot pot, and releasing tiered payouts to winners.
//!
//! ## Roles
//!
//! - **Admin** — set at `initialize`; the only address that may
//!   whitelist new game contracts via `add_game`.
//! - **Whitelisted game contracts** — the only callers authorized to
//!   `contribute` funds into the pot or trigger a `claim_jackpot` payout
//!   to one of their winners. Authorization is enforced by
//!   `require_auth()` on the calling game contract's own address, which
//!   Soroban's native cross-contract auth model makes tamper-proof: only
//!   the real registered contract can produce a valid authorization for
//!   its own address.
//!
//! ## Tiers
//!
//! - `Mini` pays out 10% of the current pot.
//! - `Major` pays out 50% of the current pot.
//! - `Mega` pays out 100% of the current pot, then re-seeds the reserve
//!   back to `seed_amount` so the jackpot never bottoms out at zero
//!   after its biggest possible win.
//!
//! ## Reentrancy and zero-pot safety
//!
//! `claim_jackpot` follows checks-effects-interactions: the pot is
//! decremented (and, on a Mega win, re-seeded) in storage *before* the
//! token transfer is issued, so a reentrant call during the transfer
//! would observe the already-updated pot rather than being able to
//! double-spend it. An empty or too-small pot is rejected outright
//! rather than issuing a zero-value transfer.
//!
//! ## Storage strategy
//! - `instance()`: `Config` (admin, token, seed amount), the running
//!   `Pot` balance, and one `Whitelist(game_address)` entry per
//!   authorized game.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{Config, Error, JackpotTier};
use types::{Contributed, GameAdded, JackpotClaimed, VaultInitialized};

#[contract]
pub struct ProgressiveJackpotVault;

#[contractimpl]
impl ProgressiveJackpotVault {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initializes the vault, pulling `seed_amount` from the admin's own
    /// balance into the vault to seed the starting pot.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        seed_amount: i128,
    ) -> Result<(), Error> {
        admin.require_auth();

        if storage::has_config(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if seed_amount < 0 {
            return Err(Error::InvalidInput);
        }

        if seed_amount > 0 {
            let token_client = token::Client::new(&env, &token);
            let contract_address = env.current_contract_address();
            token_client.transfer(&admin, &contract_address, &seed_amount);
        }

        storage::set_config(
            &env,
            &Config {
                admin: admin.clone(),
                token,
                seed_amount,
            },
        );
        storage::set_pot(&env, seed_amount);

        VaultInitialized { admin, seed_amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // add_game
    // -----------------------------------------------------------------------

    pub fn add_game(env: Env, admin: Address, game_address: Address) -> Result<(), Error> {
        admin.require_auth();

        let config = storage::get_config(&env)?;
        if admin != config.admin {
            return Err(Error::Unauthorized);
        }
        if storage::is_whitelisted(&env, &game_address) {
            return Err(Error::GameAlreadyWhitelisted);
        }

        storage::whitelist(&env, &game_address);

        GameAdded { game_address }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // contribute
    // -----------------------------------------------------------------------

    /// A whitelisted game contract funds the jackpot from its own
    /// balance. Returns the pot's new total.
    pub fn contribute(env: Env, game_address: Address, amount: i128) -> Result<i128, Error> {
        game_address.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        if !storage::is_whitelisted(&env, &game_address) {
            return Err(Error::GameNotWhitelisted);
        }

        let config = storage::get_config(&env)?;
        let new_pot = storage::get_pot(&env) + amount;
        storage::set_pot(&env, new_pot);

        let token_client = token::Client::new(&env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&game_address, &contract_address, &amount);

        Contributed {
            game_address,
            amount,
            new_pot,
        }
        .publish(&env);

        Ok(new_pot)
    }

    // -----------------------------------------------------------------------
    // claim_jackpot
    // -----------------------------------------------------------------------

    /// A whitelisted game contract releases a tiered payout from the
    /// pot to `winner`. On a `Mega` win, the pot is re-seeded back to
    /// `seed_amount` immediately after paying out.
    pub fn claim_jackpot(
        env: Env,
        game_address: Address,
        winner: Address,
        tier: JackpotTier,
    ) -> Result<i128, Error> {
        game_address.require_auth();

        if !storage::is_whitelisted(&env, &game_address) {
            return Err(Error::GameNotWhitelisted);
        }

        let config = storage::get_config(&env)?;
        let pot = storage::get_pot(&env);
        if pot <= 0 {
            return Err(Error::EmptyPot);
        }

        let percent = tier.percent();
        let payout = (pot * percent) / 100;
        if payout <= 0 {
            return Err(Error::InsufficientPot);
        }

        // Effects before interactions: settle the new pot (and re-seed
        // on a Mega win) in storage before issuing the token transfer.
        let new_pot = if matches!(tier, JackpotTier::Mega) {
            config.seed_amount
        } else {
            pot - payout
        };
        storage::set_pot(&env, new_pot);

        let token_client = token::Client::new(&env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &winner, &payout);

        JackpotClaimed {
            game_address,
            winner,
            tier_percent: percent,
            payout,
            new_pot,
        }
        .publish(&env);

        Ok(payout)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_pot(env: Env) -> i128 {
        storage::get_pot(&env)
    }

    pub fn is_game_whitelisted(env: Env, game_address: Address) -> bool {
        storage::is_whitelisted(&env, &game_address)
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        storage::get_config(&env)
    }
}
