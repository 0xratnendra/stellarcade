//! House bankroll liquidity provider vault (experimental).
//!
//! Lets community members deposit bankroll liquidity for whitelisted arcade
//! games to draw on, in return for a pro-rata share of the vault's game
//! yield. Whitelisted game contracts report profit/loss against the vault
//! via `record_game_pnl`; a performance fee is skimmed off net positive
//! yield before it is credited to LP share value. Withdrawals go through a
//! request/claim flow with a lockup window, so a large pending bet can't be
//! front-run by an LP yanking liquidity out mid-round.
//!
//! ## Storage Strategy
//! - `instance()`: admin, vault token, running `total_shares` and
//!   `total_equity`, and accrued `AdminFees`.
//! - `persistent()`: `GameAuthorized(game)`, `Shares(provider)`, and
//!   `PendingWithdraw(provider)`.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Only the admin may authorize (or revoke) a game contract's ability to
//!   call `record_game_pnl`.
//! - `deposit_liquidity` mints shares pro-rata to the vault's equity at
//!   deposit time: `amount * total_shares / total_equity` (or 1:1 into an
//!   empty vault).
//! - A provider may have at most one pending withdrawal outstanding at a
//!   time; `claim_withdraw` only succeeds once `WITHDRAW_LOCKUP_LEDGERS`
//!   have elapsed since the matching `request_withdraw`.
//! - `record_game_pnl` only adjusts internal accounting (`total_equity` and
//!   `AdminFees`); it does not itself move tokens — the calling game
//!   contract is responsible for any real token settlement with players.
//!   This keeps this vault's scope to bankroll accounting rather than full
//!   game settlement.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

pub use types::{Error, PendingWithdraw};
use types::{PERFORMANCE_FEE_BPS, WITHDRAW_LOCKUP_LEDGERS};

#[contract]
pub struct HouseBankrollLp;

#[contractimpl]
impl HouseBankrollLp {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Bootstrap the vault with an admin and the token it accepts as
    /// bankroll liquidity. May only be called once.
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
    // game whitelist
    // -----------------------------------------------------------------------

    /// Authorize (or revoke) `game`'s ability to call `record_game_pnl`.
    /// Admin-only.
    pub fn set_game_authorized(
        env: Env,
        admin: Address,
        game: Address,
        authorized: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();
        if admin != storage::get_admin(&env) {
            return Err(Error::Unauthorized);
        }
        storage::set_game_authorized(&env, &game, authorized);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit_liquidity
    // -----------------------------------------------------------------------

    /// Deposit `amount` of bankroll liquidity, minting LP shares pro-rata
    /// to the vault's current equity. Returns the number of shares minted.
    pub fn deposit_liquidity(env: Env, provider: Address, amount: i128) -> Result<u128, Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&provider, &contract_address, &amount);

        let total_shares = storage::get_total_shares(&env);
        let total_equity = storage::get_total_equity(&env);
        let shares_minted = if total_shares == 0 || total_equity == 0 {
            amount
        } else {
            amount
                .checked_mul(total_shares)
                .ok_or(Error::Overflow)?
                .checked_div(total_equity)
                .ok_or(Error::Overflow)?
        };
        if shares_minted <= 0 {
            return Err(Error::InvalidAmount);
        }

        storage::set_total_shares(
            &env,
            total_shares
                .checked_add(shares_minted)
                .ok_or(Error::Overflow)?,
        );
        storage::set_total_equity(
            &env,
            total_equity.checked_add(amount).ok_or(Error::Overflow)?,
        );
        let provider_shares = storage::get_shares(&env, &provider);
        storage::set_shares(
            &env,
            &provider,
            provider_shares
                .checked_add(shares_minted)
                .ok_or(Error::Overflow)?,
        );

        Ok(shares_minted as u128)
    }

    // -----------------------------------------------------------------------
    // request_withdraw
    // -----------------------------------------------------------------------

    /// Request to withdraw `shares`. Burns the shares and locks in their
    /// current equity value immediately; the underlying tokens are only
    /// released once `claim_withdraw` is called after the lockup window.
    /// A provider may only have one pending withdrawal outstanding at a
    /// time.
    pub fn request_withdraw(env: Env, provider: Address, shares: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();
        if shares <= 0 {
            return Err(Error::InvalidAmount);
        }
        if storage::get_pending_withdraw(&env, &provider).is_some() {
            return Err(Error::WithdrawAlreadyPending);
        }

        let provider_shares = storage::get_shares(&env, &provider);
        if shares > provider_shares {
            return Err(Error::InsufficientShares);
        }

        let total_shares = storage::get_total_shares(&env);
        let total_equity = storage::get_total_equity(&env);
        let payout = shares
            .checked_mul(total_equity)
            .ok_or(Error::Overflow)?
            .checked_div(total_shares)
            .ok_or(Error::Overflow)?;

        storage::set_shares(&env, &provider, provider_shares - shares);
        storage::set_total_shares(&env, total_shares - shares);
        storage::set_total_equity(
            &env,
            total_equity.checked_sub(payout).ok_or(Error::Overflow)?,
        );

        let claimable_at = env.ledger().sequence() + WITHDRAW_LOCKUP_LEDGERS;
        storage::set_pending_withdraw(
            &env,
            &provider,
            &PendingWithdraw {
                amount: payout,
                claimable_at,
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_withdraw
    // -----------------------------------------------------------------------

    /// Claim a previously requested withdrawal once its lockup has
    /// elapsed, transferring the locked-in token amount back to the
    /// provider. Returns the amount claimed.
    pub fn claim_withdraw(env: Env, provider: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();

        let pending =
            storage::get_pending_withdraw(&env, &provider).ok_or(Error::NoPendingWithdraw)?;
        if env.ledger().sequence() < pending.claimable_at {
            return Err(Error::LockupNotExpired);
        }
        storage::clear_pending_withdraw(&env, &provider);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &provider, &pending.amount);

        Ok(pending.amount)
    }

    // -----------------------------------------------------------------------
    // record_game_pnl
    // -----------------------------------------------------------------------

    /// Record a whitelisted game's profit or loss against the bankroll.
    /// On profit, a `PERFORMANCE_FEE_BPS` cut is skimmed to `AdminFees`
    /// before the remainder is credited to LP share value; on loss, the
    /// full amount is deducted. Only an authorized game contract may call
    /// this, and it must authorize as itself.
    pub fn record_game_pnl(
        env: Env,
        game_address: Address,
        pnl_amount: i128,
        is_profit: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        game_address.require_auth();
        if !storage::is_game_authorized(&env, &game_address) {
            return Err(Error::Unauthorized);
        }
        if pnl_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let total_equity = storage::get_total_equity(&env);
        if is_profit {
            let fee = pnl_amount
                .checked_mul(PERFORMANCE_FEE_BPS)
                .ok_or(Error::Overflow)?
                .checked_div(10_000)
                .ok_or(Error::Overflow)?;
            let net = pnl_amount.checked_sub(fee).ok_or(Error::Overflow)?;
            storage::set_total_equity(&env, total_equity.checked_add(net).ok_or(Error::Overflow)?);
            let fees = storage::get_admin_fees(&env);
            storage::set_admin_fees(&env, fees.checked_add(fee).ok_or(Error::Overflow)?);
        } else {
            let new_equity = total_equity
                .checked_sub(pnl_amount)
                .ok_or(Error::Overflow)?;
            if new_equity < 0 {
                return Err(Error::InsufficientEquity);
            }
            storage::set_total_equity(&env, new_equity);
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Current share price, scaled by `SHARE_PRICE_SCALE` (1e7) for
    /// precision. Returns the scale itself (i.e. a price of 1.0) when no
    /// shares have been minted yet.
    pub fn get_share_price(env: Env) -> i128 {
        let total_shares = storage::get_total_shares(&env);
        if total_shares == 0 {
            return types::SHARE_PRICE_SCALE;
        }
        let total_equity = storage::get_total_equity(&env);
        total_equity
            .checked_mul(types::SHARE_PRICE_SCALE)
            .and_then(|v| v.checked_div(total_shares))
            .unwrap_or(0)
    }

    /// Total value locked in the vault (the accounting equity backing all
    /// outstanding shares).
    pub fn get_total_tvl(env: Env) -> i128 {
        storage::get_total_equity(&env)
    }

    /// A provider's current share balance.
    pub fn get_shares(env: Env, provider: Address) -> i128 {
        storage::get_shares(&env, &provider)
    }

    /// Total accrued performance fees (bookkeeping only; this experimental
    /// contract does not expose a separate fee-sweep transfer).
    pub fn get_admin_fees(env: Env) -> i128 {
        storage::get_admin_fees(&env)
    }
}
