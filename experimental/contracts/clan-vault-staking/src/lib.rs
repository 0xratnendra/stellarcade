//! Clan Vault Staking
//!
//! Gaming clans pool member token deposits to unlock tournament
//! multipliers and earn a proportional share of treasury dividends.
//! Members stake into one of three lockup tiers (30/90/180 days), each
//! carrying a dividend-weight multiplier: a longer commitment earns a
//! larger slice of any given dividend distribution for the same staked
//! amount, without changing how much principal is returned on unstake.
//!
//! ## Dividend accounting
//!
//! `distribute_dividends` splits `reward_amount` across every currently
//! active stake in the clan, proportional to each stake's dividend weight
//! (`amount * multiplier_bps`) against the clan's `total_weight`. The
//! split is computed and credited to each member's claimable balance in
//! the same call — not lazily deferred — so there is no accumulator to
//! keep consistent across multiple distributions with a changing staker
//! set. This is safe here because clan membership (unlike, say, a
//! high-frequency token vault) changes far less often than distributions
//! happen, and `MAX_CLAN_MEMBERS` bounds the iteration cost.
//!
//! ## Storage Strategy
//! - `instance()`: the staking token.
//! - `persistent()`: `Clan(id)`, `Stake(clan_id, member)`,
//!   `Claimable(clan_id, member)`, and `ClanMembers(clan_id)` — each
//!   bumped on every write.
//!
//! ## Invariants
//! - A clan id can only be registered once.
//! - A member may hold at most one active stake per clan at a time.
//! - `unstake` is rejected before the stake's `unlock_at` timestamp.
//! - Only the clan's registered leader may call `distribute_dividends`.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

pub use types::Error;
use types::{
    multiplier_bps_for_duration, Clan, ClanCreated, DividendsClaimed, DividendsDistributed,
    MemberStake, Staked, Unstaked,
};

/// Vault-wide cap on simultaneously active stakes per clan, bounding
/// `distribute_dividends`'s iteration cost.
pub const MAX_CLAN_MEMBERS: u32 = 200;

#[contract]
pub struct ClanVaultStaking;

#[contractimpl]
impl ClanVaultStaking {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract with the token used for staking and
    /// dividend payouts. May only be called once.
    pub fn initialize(env: Env, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_token(&env, &token);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_clan
    // -----------------------------------------------------------------------

    /// Register a new clan with `leader` as its designated leader.
    /// `clan_id` must not already be registered.
    pub fn create_clan(env: Env, leader: Address, clan_id: String) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        leader.require_auth();

        if storage::has_clan(&env, &clan_id) {
            return Err(Error::ClanAlreadyExists);
        }

        let clan = Clan {
            clan_id: clan_id.clone(),
            leader: leader.clone(),
            total_staked: 0,
            total_weight: 0,
        };
        storage::set_clan(&env, &clan);

        ClanCreated { clan_id, leader }.publish(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // stake
    // -----------------------------------------------------------------------

    /// Stake `amount` tokens into `clan_id` for `duration` seconds, which
    /// must be exactly one of the 30/90/180-day tiers. A member may hold
    /// only one active stake per clan; call `unstake` first to restake at
    /// a different amount or duration.
    pub fn stake(
        env: Env,
        member: Address,
        clan_id: String,
        amount: i128,
        duration: u64,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        member.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidInput);
        }
        let multiplier_bps =
            multiplier_bps_for_duration(duration).ok_or(Error::InvalidLockDuration)?;

        let mut clan = storage::get_clan(&env, &clan_id)?;
        if storage::get_stake(&env, &clan_id, &member).is_some() {
            return Err(Error::InvalidInput);
        }

        let members = storage::get_clan_members(&env, &clan_id);
        if members.len() >= MAX_CLAN_MEMBERS {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&member, &contract_address, &amount);

        let now = env.ledger().timestamp();
        let unlock_at = now.checked_add(duration).ok_or(Error::InvalidInput)?;
        let weight = (amount as u128)
            .checked_mul(multiplier_bps)
            .ok_or(Error::InvalidInput)?;

        let stake_record = MemberStake {
            member: member.clone(),
            clan_id: clan_id.clone(),
            amount,
            duration,
            multiplier_bps,
            staked_at: now,
            unlock_at,
        };
        storage::set_stake(&env, &stake_record);
        storage::add_clan_member(&env, &clan_id, &member);

        clan.total_staked = clan
            .total_staked
            .checked_add(amount)
            .ok_or(Error::InvalidInput)?;
        clan.total_weight = clan
            .total_weight
            .checked_add(weight)
            .ok_or(Error::InvalidInput)?;
        storage::set_clan(&env, &clan);

        Staked {
            clan_id,
            member,
            amount,
            duration,
            unlock_at,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // distribute_dividends
    // -----------------------------------------------------------------------

    /// Clan-leader-only: deposit `reward_amount` tokens and split them
    /// across every currently active stake in `clan_id`, proportional to
    /// each stake's dividend weight (`amount * multiplier_bps`) against
    /// the clan's total weight. Credits each member's claimable balance
    /// directly rather than requiring a later per-member settlement step.
    pub fn distribute_dividends(
        env: Env,
        leader: Address,
        clan_id: String,
        reward_amount: i128,
    ) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        leader.require_auth();

        if reward_amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let clan = storage::get_clan(&env, &clan_id)?;
        if leader != clan.leader {
            return Err(Error::NotClanLeader);
        }
        if clan.total_weight == 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&leader, &contract_address, &reward_amount);

        let members = storage::get_clan_members(&env, &clan_id);
        for member in members.iter() {
            let stake_record = match storage::get_stake(&env, &clan_id, &member) {
                Some(s) => s,
                None => continue,
            };
            let weight = (stake_record.amount as u128)
                .checked_mul(stake_record.multiplier_bps)
                .ok_or(Error::InvalidInput)?;
            let share = (reward_amount as u128)
                .checked_mul(weight)
                .and_then(|v| v.checked_div(clan.total_weight))
                .ok_or(Error::InvalidInput)? as i128;

            let existing_claimable = storage::get_claimable(&env, &clan_id, &member);
            storage::set_claimable(
                &env,
                &clan_id,
                &member,
                existing_claimable
                    .checked_add(share)
                    .ok_or(Error::InvalidInput)?,
            );
        }

        DividendsDistributed {
            clan_id,
            reward_amount,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_dividends
    // -----------------------------------------------------------------------

    /// Claim `member`'s accumulated dividend balance in `clan_id`.
    pub fn claim_dividends(env: Env, member: Address, clan_id: String) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        member.require_auth();

        let claimable = storage::get_claimable(&env, &clan_id, &member);
        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        storage::set_claimable(&env, &clan_id, &member, 0);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &member, &claimable);

        DividendsClaimed {
            clan_id,
            member,
            amount: claimable,
        }
        .publish(&env);

        Ok(claimable)
    }

    // -----------------------------------------------------------------------
    // unstake
    // -----------------------------------------------------------------------

    /// Release `member`'s staked principal in `clan_id` back to them.
    /// Rejected if the stake's lock period has not yet expired. Does not
    /// touch any already-credited, unclaimed dividend balance.
    pub fn unstake(env: Env, member: Address, clan_id: String) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        member.require_auth();

        let stake_record =
            storage::get_stake(&env, &clan_id, &member).ok_or(Error::StakeNotFound)?;

        if env.ledger().timestamp() < stake_record.unlock_at {
            return Err(Error::LockNotYetExpired);
        }

        let mut clan = storage::get_clan(&env, &clan_id)?;
        let weight = (stake_record.amount as u128)
            .checked_mul(stake_record.multiplier_bps)
            .ok_or(Error::InvalidInput)?;
        clan.total_staked = clan
            .total_staked
            .checked_sub(stake_record.amount)
            .ok_or(Error::InvalidInput)?;
        clan.total_weight = clan
            .total_weight
            .checked_sub(weight)
            .ok_or(Error::InvalidInput)?;
        storage::set_clan(&env, &clan);

        storage::remove_stake(&env, &clan_id, &member);
        storage::remove_clan_member(&env, &clan_id, &member);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &member, &stake_record.amount);

        Unstaked {
            clan_id,
            member,
            amount: stake_record.amount,
        }
        .publish(&env);

        Ok(stake_record.amount)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_clan(env: Env, clan_id: String) -> Result<Clan, Error> {
        storage::get_clan(&env, &clan_id)
    }

    pub fn get_stake(env: Env, clan_id: String, member: Address) -> Option<MemberStake> {
        storage::get_stake(&env, &clan_id, &member)
    }

    pub fn get_claimable(env: Env, clan_id: String, member: Address) -> i128 {
        storage::get_claimable(&env, &clan_id, &member)
    }
}
