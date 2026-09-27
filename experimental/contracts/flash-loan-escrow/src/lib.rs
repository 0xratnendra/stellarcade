//! Flash Loan Escrow
//!
//! An arcade liquidity flash escrow. Liquidity providers deposit tokens
//! and earn a share of flash loan fees; arbitrage bots and market makers
//! borrow instantly, uncollateralized, for exactly one transaction, and
//! must repay the loan plus fee before the call returns or the entire
//! transaction reverts.
//!
//! ## Borrower callback interface
//!
//! `flash_loan` calls the borrower contract's own `execute_operation`
//! entrypoint, expected to have this signature:
//!
//! ```text
//! fn execute_operation(env: Env, token: Address, amount: i128, fee: i128, params: Vec<Val>) -> bool;
//! ```
//!
//! The borrower contract is responsible for pulling the loaned `amount`
//! (already transferred to it before the callback), doing whatever it
//! needs to with it, and transferring back `amount + fee` to this
//! contract before `execute_operation` returns. `flash_loan` verifies the
//! post-callback balance itself — a borrower that returns `true` without
//! actually repaying is still rejected, since the balance check does not
//! trust the callback's own return value about its own success.
//!
//! ## Fee accounting
//!
//! Uses a reward-per-share accumulator (`FeeAccumulator`, the same shape
//! as a yield-bearing vault's index) rather than iterating every provider
//! on every loan: each repaid loan bumps a single global accumulator by
//! `fee * ACC_PRECISION / total_principal`, and a provider's newly-earned
//! fees since their last checkpoint are computed in O(1) as `(current_acc
//! - provider's checkpoint) * provider_principal / ACC_PRECISION`.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, fee_bps, total principal, and the fee
//!   accumulator. Small, shared config.
//! - `persistent()`: `ProviderPrincipal`, `ProviderFeeAccChkpt`, and
//!   `ProviderFeesEarned`, each keyed by provider and bumped on every
//!   write.
//!
//! ## Invariants
//! - A flash loan that is not fully repaid (`amount + fee`) by the time
//!   the borrower's callback returns causes the entire call to error out,
//!   reverting any state changes the callback itself made too (Soroban's
//!   default all-or-nothing transaction semantics).
//! - A provider's fee balance is always settled (checkpointed) before
//!   their principal changes, so depositing or withdrawing never loses
//!   already-earned, unclaimed fees.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, IntoVal, Symbol, Val, Vec};

pub use types::Error;
use types::{
    FlashLoanExecuted, LiquidityDeposited, LiquidityWithdrawn, ACC_PRECISION, BPS_DENOMINATOR,
};

#[contract]
pub struct FlashLoanEscrow;

#[contractimpl]
impl FlashLoanEscrow {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, token: Address, fee_bps: u32) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps == 0 || fee_bps > BPS_DENOMINATOR {
            return Err(Error::InvalidInput);
        }

        admin.require_auth();

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_fee_bps(&env, fee_bps);
        storage::set_total_principal(&env, 0);
        storage::set_fee_accumulator(&env, 0);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // set_fee_bps
    // -----------------------------------------------------------------------

    /// Admin-only: update the flash loan fee rate for future loans. Does
    /// not retroactively change the fee owed on a loan already in
    /// progress (there is no such thing across calls in Soroban's
    /// single-invocation model anyway).
    pub fn set_fee_bps(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if fee_bps == 0 || fee_bps > BPS_DENOMINATOR {
            return Err(Error::InvalidInput);
        }

        storage::set_fee_bps(&env, fee_bps);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit_liquidity
    // -----------------------------------------------------------------------

    pub fn deposit_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        settle_provider_fees(&env, &provider);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&provider, &contract_address, &amount);

        let new_principal = storage::get_provider_principal(&env, &provider) + amount;
        storage::set_provider_principal(&env, &provider, new_principal);

        let total_principal = storage::get_total_principal(&env) + amount;
        storage::set_total_principal(&env, total_principal);

        LiquidityDeposited {
            provider,
            amount,
            total_principal,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // withdraw_liquidity
    // -----------------------------------------------------------------------

    /// Withdraw up to `amount` of the caller's own deposited principal
    /// (not their earned fees, which are withdrawn separately via
    /// `claim_fees`).
    pub fn withdraw_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        settle_provider_fees(&env, &provider);

        let principal = storage::get_provider_principal(&env, &provider);
        if amount > principal {
            return Err(Error::InsufficientLiquidity);
        }

        storage::set_provider_principal(&env, &provider, principal - amount);
        storage::set_total_principal(&env, storage::get_total_principal(&env) - amount);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &provider, &amount);

        LiquidityWithdrawn { provider, amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_fees
    // -----------------------------------------------------------------------

    pub fn claim_fees(env: Env, provider: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        provider.require_auth();

        settle_provider_fees(&env, &provider);

        let earned = storage::get_provider_fees_earned(&env, &provider);
        if earned <= 0 {
            return Err(Error::NoDeposit);
        }

        storage::set_provider_fees_earned(&env, &provider, 0);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &provider, &earned);

        Ok(earned)
    }

    // -----------------------------------------------------------------------
    // flash_loan
    // -----------------------------------------------------------------------

    /// Borrow `amount` of the escrow token for exactly one transaction.
    /// Transfers `amount` to `borrower_contract`, invokes its
    /// `execute_operation(token, amount, fee, params)` callback, then
    /// requires this contract's own balance to have increased back to at
    /// least what it was before the loan plus the fee. If it hasn't, this
    /// call errors, and — because Soroban transactions are all-or-nothing —
    /// every state change the callback itself made (including any partial
    /// repayment) is rolled back along with it.
    pub fn flash_loan(
        env: Env,
        borrower_contract: Address,
        token: Address,
        amount: i128,
        params: Vec<Val>,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        let balance_before = token_client.balance(&contract_address);

        if amount > balance_before {
            return Err(Error::InsufficientLiquidity);
        }

        let fee_bps = storage::get_fee_bps(&env);
        let fee = amount
            .checked_mul(fee_bps as i128)
            .and_then(|v| v.checked_div(BPS_DENOMINATOR as i128))
            .ok_or(Error::InvalidInput)?;

        token_client.transfer(&contract_address, &borrower_contract, &amount);

        let _: bool = env.invoke_contract(
            &borrower_contract,
            &Symbol::new(&env, "execute_operation"),
            soroban_sdk::vec![
                &env,
                token.into_val(&env),
                amount.into_val(&env),
                fee.into_val(&env),
                params.into_val(&env)
            ],
        );

        let balance_after = token_client.balance(&contract_address);
        let required_balance = balance_before.checked_add(fee).ok_or(Error::InvalidInput)?;
        if balance_after < required_balance {
            return Err(Error::LoanNotRepaid);
        }

        // Distribute the fee across current liquidity providers via the
        // accumulator; a zero total_principal means there is no LP to
        // credit (shouldn't happen if `amount <= balance_before` held,
        // since balance implies deposits exist, but guarded regardless).
        let total_principal = storage::get_total_principal(&env);
        if total_principal > 0 {
            let acc_increment = fee
                .checked_mul(ACC_PRECISION)
                .and_then(|v| v.checked_div(total_principal))
                .ok_or(Error::InvalidInput)?;
            storage::set_fee_accumulator(&env, storage::get_fee_accumulator(&env) + acc_increment);
        }

        FlashLoanExecuted {
            borrower_contract,
            amount,
            fee,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_fee_bps(env: Env) -> u32 {
        storage::get_fee_bps(&env)
    }

    pub fn get_provider_principal(env: Env, provider: Address) -> i128 {
        storage::get_provider_principal(&env, &provider)
    }

    /// Return `provider`'s current earned-fee balance, INCLUDING fees
    /// accrued since their last checkpoint (a read-only projection; does
    /// not itself write the checkpoint).
    pub fn get_provider_fees_earned(env: Env, provider: Address) -> i128 {
        let settled = storage::get_provider_fees_earned(&env, &provider);
        let pending = pending_fees_since_checkpoint(&env, &provider);
        settled + pending
    }
}

/// Fees earned by `provider` since their last checkpoint, not yet folded
/// into `ProviderFeesEarned`.
fn pending_fees_since_checkpoint(env: &Env, provider: &Address) -> i128 {
    let current_acc = storage::get_fee_accumulator(env);
    let checkpoint = storage::get_provider_fee_acc_checkpoint(env, provider);
    let principal = storage::get_provider_principal(env, provider);

    if principal == 0 || current_acc <= checkpoint {
        return 0;
    }

    (current_acc - checkpoint) * principal / ACC_PRECISION
}

/// Fold any fees earned since `provider`'s last checkpoint into their
/// settled `ProviderFeesEarned` balance, and advance their checkpoint to
/// the current accumulator. MUST be called before any change to a
/// provider's principal, so depositing/withdrawing never loses
/// already-earned fees computed against the OLD principal.
fn settle_provider_fees(env: &Env, provider: &Address) {
    let pending = pending_fees_since_checkpoint(env, provider);
    if pending > 0 {
        let earned = storage::get_provider_fees_earned(env, provider) + pending;
        storage::set_provider_fees_earned(env, provider, earned);
    }
    storage::set_provider_fee_acc_checkpoint(env, provider, storage::get_fee_accumulator(env));
}
