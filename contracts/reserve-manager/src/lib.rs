#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use crate::storage::{
    get_assets, get_config, get_reserve_state, set_assets, set_config, set_reserve_state,
};
use crate::types::{
    ManagerConfig, ManagerThresholdSummary, OptionalManagerConfig, ReserveSnapshot, ReserveState,
    ReserveStatus,
};
use soroban_sdk::{contract, contracterror, contractevent, contractimpl, Address, Env, Vec};

/// Sweep cooldown expressed in ledgers (2_880 ≈ 4 hours at 5 s/ledger).
const SWEEP_COOLDOWN_LEDGERS: u32 = 2_880;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    Paused = 4,
    Overflow = 5,
}

#[contractevent]
pub struct ReserveUpdated {
    #[topic]
    pub asset: Address,
    pub new_balance: i128,
    pub status: ReserveStatus,
}

#[contract]
pub struct ReserveManager;

#[contractimpl]
impl ReserveManager {
    /// Initialize the reserve manager.
    pub fn init(env: Env, admin: Address, treasury: Address) -> Result<(), Error> {
        if get_config(&env).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        let config = ManagerConfig {
            admin,
            treasury,
            is_paused: false,
        };
        set_config(&env, &config);
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

    /// Update an asset's reserve targets and current balance. Admin only.
    pub fn update_reserve(
        env: Env,
        asset: Address,
        balance: i128,
        target: i128,
    ) -> Result<(), Error> {
        let config = get_config(&env).ok_or(Error::NotInitialized)?;
        if config.is_paused {
            return Err(Error::Paused);
        }
        config.admin.require_auth();

        let mut assets = get_assets(&env);
        if !assets.contains(&asset) {
            assets.push_back(asset.clone());
            set_assets(&env, &assets);
        }

        let status = if balance >= target {
            ReserveStatus::Healthy
        } else if balance >= target / 2 {
            ReserveStatus::BelowTarget
        } else {
            ReserveStatus::Critical
        };

        let state = ReserveState {
            asset: asset.clone(),
            balance,
            target_balance: target,
            status: status.clone(),
            last_audit_ledger: env.ledger().sequence(),
        };

        set_reserve_state(&env, &asset, &state);

        ReserveUpdated {
            asset,
            new_balance: balance,
            status,
        }
        .publish(&env);

        Ok(())
    }

    // ─── Public Read-Only Methods ──────────────────────────────────────────

    /// Returns a complete snapshot of all managed reserves.
    ///
    /// # Returns
    /// A `ReserveSnapshot` containing current configuration and states for all tracked assets.
    /// Handles uninitialized state by returning `None` for config and an empty list of reserves.
    pub fn get_full_snapshot(env: Env) -> ReserveSnapshot {
        let config = get_config(&env);
        let assets = get_assets(&env);
        let mut reserves = Vec::new(&env);

        for asset in assets.iter() {
            if let Some(state) = get_reserve_state(&env, &asset) {
                reserves.push_back(state);
            }
        }

        ReserveSnapshot {
            config: OptionalManagerConfig::from(config),
            reserves,
            ledger: env.ledger().sequence(),
        }
    }

    /// Returns the reserve state for a specific asset.
    /// Returns `None` if the asset is not managed.
    pub fn get_reserve_for(env: Env, asset: Address) -> Option<ReserveState> {
        get_reserve_state(&env, &asset)
    }

    /// Returns whether the manager is paused.
    pub fn is_paused(env: Env) -> bool {
        get_config(&env).map(|c| c.is_paused).unwrap_or(true)
    }

    /// Return the sweep cooldown in ledgers.
    ///
    /// The sweep cooldown is the minimum gap between successive treasury sweeps.
    /// It is a fixed contract constant so consumers share a single source of truth.
    pub fn sweep_cooldown_ledgers(_env: Env) -> u32 {
        SWEEP_COOLDOWN_LEDGERS
    }

    /// Return a threshold health summary across all managed reserves.
    ///
    /// Counts healthy, below-target, and critical reserves, and the number that
    /// meet or exceed their target balance. Returns zero counts when uninitialized.
    pub fn manager_threshold_summary(env: Env) -> ManagerThresholdSummary {
        let config = get_config(&env);
        let is_paused = config.as_ref().map(|c| c.is_paused).unwrap_or(false);
        let assets = get_assets(&env);

        let mut healthy_count = 0u32;
        let mut below_target_count = 0u32;
        let mut critical_count = 0u32;

        for asset in assets.iter() {
            if let Some(state) = get_reserve_state(&env, &asset) {
                match state.status {
                    ReserveStatus::Healthy => healthy_count = healthy_count.saturating_add(1),
                    ReserveStatus::BelowTarget => {
                        below_target_count = below_target_count.saturating_add(1)
                    }
                    ReserveStatus::Critical => critical_count = critical_count.saturating_add(1),
                    ReserveStatus::Paused => {}
                }
            }
        }

        let total_assets = assets.len();
        let at_or_above_threshold_count = healthy_count;

        ManagerThresholdSummary {
            total_assets,
            healthy_count,
            below_target_count,
            critical_count,
            at_or_above_threshold_count,
            sweep_cooldown_ledgers: SWEEP_COOLDOWN_LEDGERS,
            is_paused,
        }
    }
}
