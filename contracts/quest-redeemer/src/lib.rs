#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use crate::storage::{
    get_config, get_verifier, has_completion, has_redeemed, record_completion, record_redemption,
    set_config, set_verifier,
};
use crate::types::{
    OptionalRedeemerConfig, RedeemerConfig, RedemptionSnapshot, RedemptionStatus, RewardGap,
};
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    Paused = 4,
    AlreadyRedeemed = 5,
    InvalidQuest = 6,
    NotCompleted = 7,
    NotVerifier = 8,
}

#[contractevent]
pub struct QuestRedeemed {
    #[topic]
    pub user: Address,
    #[topic]
    pub quest_id: u32,
    pub reward_amount: i128,
}

#[contract]
pub struct QuestRedeemer;

#[contractimpl]
impl QuestRedeemer {
    /// Initialize the quest redeemer.
    pub fn init(
        env: Env,
        admin: Address,
        quest_board: Address,
        token: Address,
    ) -> Result<(), Error> {
        if get_config(&env).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let config = RedeemerConfig {
            admin,
            quest_board,
            token,
            is_paused: false,
        };
        set_config(&env, &config);
        Ok(())
    }

    /// Set the trusted verifier address. Admin only.
    pub fn set_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        let config = get_config(&env).ok_or(Error::NotInitialized)?;
        admin.require_auth();
        if admin != config.admin {
            return Err(Error::NotAuthorized);
        }
        set_verifier(&env, &verifier);
        Ok(())
    }

    /// Record that a player has completed a quest. Verifier only.
    pub fn mark_complete(
        env: Env,
        verifier: Address,
        player: Address,
        quest_id: u32,
    ) -> Result<(), Error> {
        get_config(&env).ok_or(Error::NotInitialized)?;
        verifier.require_auth();
        let stored = get_verifier(&env).ok_or(Error::NotVerifier)?;
        if verifier != stored {
            return Err(Error::NotVerifier);
        }
        record_completion(&env, &player, quest_id);
        Ok(())
    }

    /// Set the paused state. Admin only.
    pub fn set_pause(env: Env, paused: bool) -> Result<(), Error> {
        let mut config = get_config(&env).ok_or(Error::NotInitialized)?;
        config.admin.require_auth();
        config.is_paused = paused;
        set_config(&env, &config);
        Ok(())
    }

    /// Redeem a quest reward for the caller.
    pub fn redeem(env: Env, user: Address, quest_id: u32) -> Result<(), Error> {
        let config = get_config(&env).ok_or(Error::NotInitialized)?;
        if config.is_paused {
            return Err(Error::Paused);
        }
        user.require_auth();

        if has_redeemed(&env, &user, quest_id) {
            return Err(Error::AlreadyRedeemed);
        }

        if !has_completion(&env, &user, quest_id) {
            return Err(Error::NotCompleted);
        }

        record_redemption(&env, &user, quest_id);

        QuestRedeemed {
            user,
            quest_id,
            reward_amount: 0,
        }
        .publish(&env);

        Ok(())
    }

    // ─── Public Read-Only Methods ──────────────────────────────────────────

    /// Returns a complete snapshot of redemption status for a specific user and quest.
    ///
    /// # Returns
    /// A `RedemptionSnapshot` containing the current status (Eligible, Redeemed, etc.).
    /// Handles uninitialized state by returning `None` for config and `Paused` status.
    pub fn get_redemption_snapshot(env: Env, user: Address, quest_id: u32) -> RedemptionSnapshot {
        let config = get_config(&env);

        let status = if let Some(ref c) = config {
            if c.is_paused {
                RedemptionStatus::Paused
            } else if has_redeemed(&env, &user, quest_id) {
                RedemptionStatus::Redeemed
            } else {
                RedemptionStatus::Eligible
            }
        } else {
            RedemptionStatus::Paused
        };

        RedemptionSnapshot {
            config: OptionalRedeemerConfig::from(config),
            status,
            user,
            quest_id,
            timestamp: env.ledger().timestamp(),
        }
    }

    /// Backwards-compatible alias for the turn-in queue summary accessor.
    pub fn turn_in_queue_summary(env: Env, user: Address, quest_id: u32) -> RedemptionSnapshot {
        Self::get_redemption_snapshot(env, user, quest_id)
    }

    /// Returns how far a quest turn-in is from being claimable.
    ///
    /// Zero-state behavior:
    /// - Uninitialized or paused contracts return `reward_gap = 1`.
    /// - Redeemed quests return `reward_gap = 0`.
    pub fn reward_gap(env: Env, user: Address, quest_id: u32) -> RewardGap {
        let RedemptionSnapshot {
            config,
            status,
            user,
            quest_id,
            timestamp,
        } = Self::get_redemption_snapshot(env, user, quest_id);

        let ready_to_turn_in = matches!(&status, RedemptionStatus::Eligible);
        let reward_gap = if ready_to_turn_in || matches!(&status, RedemptionStatus::Redeemed) {
            0
        } else {
            1
        };

        RewardGap {
            config,
            status,
            user,
            quest_id,
            reward_gap,
            ready_to_turn_in,
            timestamp,
        }
    }

    /// Checks if a specific redemption has already occurred.
    pub fn has_redeemed(env: Env, user: Address, quest_id: u32) -> bool {
        has_redeemed(&env, &user, quest_id)
    }

    /// Returns whether redemptions are globally paused.
    pub fn is_paused(env: Env) -> bool {
        get_config(&env).map(|c| c.is_paused).unwrap_or(true)
    }
}
