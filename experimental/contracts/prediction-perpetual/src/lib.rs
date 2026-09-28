//! Binary outcome prediction market escrow (experimental).
//!
//! Pari-mutuel YES/NO betting pools with oracle-resolved outcomes. Winners
//! split the full pool (their own stake plus the losing side's pool)
//! proportional to their share of the winning pool.
//!
//! ## Storage Strategy
//! - `instance()`: admin, escrow token, and the market id counter.
//! - `persistent()`: `Market(id)` and `Bet(id, player)`.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Betting is rejected once a market's `end_time` has passed or once it
//!   has been resolved.
//! - Only a market's designated `oracle` may resolve it, and only after
//!   `end_time` has passed (so no further bets can land once the outcome
//!   is knowable).
//! - Each player may claim their winnings on a market at most once.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use types::Bet;
pub use types::{Error, Market};

#[contract]
pub struct PredictionPerpetual;

#[contractimpl]
impl PredictionPerpetual {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Bootstrap the contract with an admin and the token used to escrow
    /// bets. May only be called once.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_market
    // -----------------------------------------------------------------------

    /// Create a new binary prediction market that closes for betting at
    /// `end_time` (a unix timestamp). `oracle` must authorize its own
    /// creation, since it is the sole address permitted to resolve the
    /// market once betting closes. Returns the new market's id.
    pub fn create_market(
        env: Env,
        oracle: Address,
        question: String,
        end_time: u64,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        oracle.require_auth();
        if end_time <= env.ledger().timestamp() {
            return Err(Error::InvalidEndTime);
        }

        let market_id = storage::next_market_id(&env);
        let market = Market {
            oracle,
            question,
            end_time,
            yes_pool: 0,
            no_pool: 0,
            resolved: false,
            winning_is_yes: None,
        };
        storage::save_market(&env, market_id, &market);
        Ok(market_id)
    }

    // -----------------------------------------------------------------------
    // place_bet
    // -----------------------------------------------------------------------

    /// Stake `amount` on the YES (`is_yes = true`) or NO side of
    /// `market_id`. Rejected once the market has passed its `end_time` or
    /// has already been resolved.
    pub fn place_bet(
        env: Env,
        player: Address,
        market_id: u64,
        is_yes: bool,
        amount: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        player.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut market = storage::load_market(&env, market_id)?;
        if market.resolved {
            return Err(Error::AlreadyResolved);
        }
        if env.ledger().timestamp() >= market.end_time {
            return Err(Error::MarketExpired);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &amount);

        if is_yes {
            market.yes_pool = market.yes_pool.checked_add(amount).ok_or(Error::Overflow)?;
        } else {
            market.no_pool = market.no_pool.checked_add(amount).ok_or(Error::Overflow)?;
        }
        storage::save_market(&env, market_id, &market);

        let mut bet = storage::load_bet(&env, market_id, &player);
        if is_yes {
            bet.yes_amount = bet.yes_amount.checked_add(amount).ok_or(Error::Overflow)?;
        } else {
            bet.no_amount = bet.no_amount.checked_add(amount).ok_or(Error::Overflow)?;
        }
        storage::save_bet(&env, market_id, &player, &bet);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // resolve
    // -----------------------------------------------------------------------

    /// Resolve `market_id` with the winning outcome. Only the market's
    /// designated oracle may call this, and only once `end_time` has
    /// passed.
    pub fn resolve(
        env: Env,
        oracle: Address,
        market_id: u64,
        winning_is_yes: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        oracle.require_auth();

        let mut market = storage::load_market(&env, market_id)?;
        if oracle != market.oracle {
            return Err(Error::Unauthorized);
        }
        if market.resolved {
            return Err(Error::AlreadyResolved);
        }
        if env.ledger().timestamp() < market.end_time {
            return Err(Error::MarketNotExpired);
        }

        market.resolved = true;
        market.winning_is_yes = Some(winning_is_yes);
        storage::save_market(&env, market_id, &market);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim
    // -----------------------------------------------------------------------

    /// Claim `player`'s pro-rata share of `market_id`'s pool. Payout is
    /// `stake_on_winning_side * total_pool / winning_pool` — i.e. the
    /// player's own stake back plus a proportional cut of the losing
    /// pool. Each player may claim at most once per market.
    pub fn claim(env: Env, player: Address, market_id: u64) -> Result<u128, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let market = storage::load_market(&env, market_id)?;
        if !market.resolved {
            return Err(Error::NotResolved);
        }
        let winning_is_yes = market.winning_is_yes.ok_or(Error::NotResolved)?;

        let mut bet = storage::load_bet(&env, market_id, &player);
        if bet.claimed {
            return Err(Error::AlreadyClaimed);
        }

        let stake = if winning_is_yes {
            bet.yes_amount
        } else {
            bet.no_amount
        };
        if stake <= 0 {
            return Err(Error::NoWinningStake);
        }

        let winning_pool = if winning_is_yes {
            market.yes_pool
        } else {
            market.no_pool
        };
        let total_pool = market
            .yes_pool
            .checked_add(market.no_pool)
            .ok_or(Error::Overflow)?;
        let payout = stake
            .checked_mul(total_pool)
            .ok_or(Error::Overflow)?
            .checked_div(winning_pool)
            .ok_or(Error::Overflow)?;

        bet.claimed = true;
        storage::save_bet(&env, market_id, &player, &bet);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &player, &payout);

        Ok(payout as u128)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// The current implied odds for `market_id`, in basis points out of
    /// 10,000, derived from the live YES/NO pool balances. Returns
    /// `(5_000, 5_000)` before any bets have been placed.
    pub fn get_implied_odds(env: Env, market_id: u64) -> Result<(u32, u32), Error> {
        let market = storage::load_market(&env, market_id)?;
        let total = market
            .yes_pool
            .checked_add(market.no_pool)
            .ok_or(Error::Overflow)?;
        if total == 0 {
            return Ok((5_000, 5_000));
        }
        let yes_bps = market
            .yes_pool
            .checked_mul(10_000)
            .ok_or(Error::Overflow)?
            .checked_div(total)
            .ok_or(Error::Overflow)? as u32;
        Ok((yes_bps, 10_000 - yes_bps))
    }

    /// Read-only access to a market's state.
    pub fn get_market(env: Env, market_id: u64) -> Result<Market, Error> {
        storage::load_market(&env, market_id)
    }

    /// Read-only access to a player's bet on a market.
    pub fn get_bet(env: Env, market_id: u64, player: Address) -> Bet {
        storage::load_bet(&env, market_id, &player)
    }
}
