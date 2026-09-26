//! Royalty Splitter
//!
//! Distributes tournament rake and arcade game fees among developers, the
//! house, and community pools according to configured basis-point shares.
//! Revenue can be distributed either as an immediate push (direct
//! transfers to every recipient in one call) or accumulated into
//! per-recipient claimable balances that recipients withdraw on their own
//! schedule via `claim_shares`.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, the parallel `recipients`/`shares` arrays, and
//!   any pending timelocked share update. Small, shared config.
//! - `persistent()`: `Claimable(recipient, token)`, bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - `recipients` and `shares` are always the same length, and `shares`
//!   must sum to exactly `BPS_DENOMINATOR` (100%), both at `initialize`
//!   and for any proposed update.
//! - A share update must be proposed and then wait
//!   `SHARE_UPDATE_TIMELOCK_LEDGERS` before it can be executed.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub use types::Error;
use types::{
    PendingShareUpdate, RevenueDistributed, ShareUpdateExecuted, ShareUpdateProposed,
    SharesClaimed, SplitterInitialized, BPS_DENOMINATOR, SHARE_UPDATE_TIMELOCK_LEDGERS,
};

#[contract]
pub struct RoyaltySplitter;

#[contractimpl]
impl RoyaltySplitter {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the splitter with a fixed recipient list and their basis
    /// point shares (parallel arrays; `shares[i]` is `recipients[i]`'s
    /// share). `shares` must sum to exactly `BPS_DENOMINATOR` (100%).
    pub fn initialize(
        env: Env,
        admin: Address,
        recipients: Vec<Address>,
        shares: Vec<u32>,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();
        validate_shares(&recipients, &shares)?;

        storage::set_admin(&env, &admin);
        storage::set_recipients(&env, &recipients);
        storage::set_shares(&env, &shares);

        SplitterInitialized {
            admin,
            recipient_count: recipients.len(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // distribute_revenue
    // -----------------------------------------------------------------------

    /// Distribute `total_amount` of `token` (already held by, or being
    /// deposited into, this contract) among the configured recipients
    /// proportional to their shares.
    ///
    /// If `push` is `true`, transfers each recipient's share directly in
    /// this same call. If `false`, accumulates each recipient's share into
    /// their claimable balance for later withdrawal via `claim_shares`
    /// instead. The remainder from basis-point rounding (any amount left
    /// over after every recipient's floor-rounded share is allocated) is
    /// added to the LAST recipient's share, so no dust is ever silently
    /// lost or left stuck in the contract.
    pub fn distribute_revenue(
        env: Env,
        depositor: Address,
        token: Address,
        total_amount: i128,
        push: bool,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        depositor.require_auth();

        if total_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&depositor, &contract_address, &total_amount);

        let recipients = storage::get_recipients(&env);
        let shares = storage::get_shares(&env);

        let mut allocated: i128 = 0;
        let count = recipients.len();
        for i in 0..count {
            let recipient = recipients.get(i).unwrap();
            let share_bps = shares.get(i).unwrap();

            let mut amount = total_amount
                .checked_mul(share_bps as i128)
                .and_then(|v| v.checked_div(BPS_DENOMINATOR as i128))
                .ok_or(Error::InvalidInput)?;

            // Last recipient absorbs any rounding remainder.
            if i == count - 1 {
                amount = total_amount - allocated;
            }
            allocated += amount;

            if push {
                if amount > 0 {
                    token_client.transfer(&contract_address, &recipient, &amount);
                }
            } else {
                let existing = storage::get_claimable(&env, &recipient, &token);
                storage::set_claimable(&env, &recipient, &token, existing + amount);
            }
        }

        RevenueDistributed {
            token,
            total_amount,
            pushed: push,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_shares
    // -----------------------------------------------------------------------

    /// Withdraw `recipient`'s full accumulated claimable balance of
    /// `token`. Errors if there is nothing to claim.
    pub fn claim_shares(env: Env, recipient: Address, token: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        recipient.require_auth();

        let amount = storage::get_claimable(&env, &recipient, &token);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }

        storage::set_claimable(&env, &recipient, &token, 0);

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &recipient, &amount);

        SharesClaimed {
            recipient,
            token,
            amount,
        }
        .publish(&env);

        Ok(amount)
    }

    // -----------------------------------------------------------------------
    // propose_share_update / execute_share_update
    // -----------------------------------------------------------------------

    /// Admin-only: propose a new recipient/share configuration. Takes
    /// effect only after `execute_share_update` is called at or after
    /// `SHARE_UPDATE_TIMELOCK_LEDGERS` ledgers from now, giving recipients
    /// a window to notice and react to a proposed reallocation before it
    /// takes effect.
    pub fn propose_share_update(
        env: Env,
        admin: Address,
        recipients: Vec<Address>,
        shares: Vec<u32>,
    ) -> Result<u32, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        validate_shares(&recipients, &shares)?;

        let executable_at = env.ledger().sequence() + SHARE_UPDATE_TIMELOCK_LEDGERS;
        storage::set_pending_update(
            &env,
            &PendingShareUpdate {
                recipients,
                shares,
                executable_at,
            },
        );

        ShareUpdateProposed { executable_at }.publish(&env);

        Ok(executable_at)
    }

    /// Execute a previously proposed share update once its timelock has
    /// elapsed. Callable by anyone once the delay has passed; the
    /// timelock itself is the safeguard, not caller authorization.
    pub fn execute_share_update(env: Env) -> Result<(), Error> {
        storage::require_initialized(&env)?;

        let pending = storage::get_pending_update(&env).ok_or(Error::NoPendingUpdate)?;
        if env.ledger().sequence() < pending.executable_at {
            return Err(Error::TimelockNotExpired);
        }

        storage::set_recipients(&env, &pending.recipients);
        storage::set_shares(&env, &pending.shares);
        storage::clear_pending_update(&env);

        ShareUpdateExecuted {
            recipient_count: pending.recipients.len(),
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_recipients(env: Env) -> Vec<Address> {
        storage::get_recipients(&env)
    }

    pub fn get_shares(env: Env) -> Vec<u32> {
        storage::get_shares(&env)
    }

    pub fn get_claimable(env: Env, recipient: Address, token: Address) -> i128 {
        storage::get_claimable(&env, &recipient, &token)
    }
}

fn validate_shares(recipients: &Vec<Address>, shares: &Vec<u32>) -> Result<(), Error> {
    if recipients.len() != shares.len() {
        return Err(Error::MismatchedRecipientsAndShares);
    }
    if recipients.is_empty() {
        return Err(Error::InvalidInput);
    }

    let mut total: u32 = 0;
    for share in shares.iter() {
        total = total.checked_add(share).ok_or(Error::InvalidInput)?;
    }
    if total != BPS_DENOMINATOR {
        return Err(Error::SharesMustSumToTenThousand);
    }

    Ok(())
}
