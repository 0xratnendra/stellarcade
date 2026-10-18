use soroban_sdk::{contracttype, Address, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReserveStatus {
    Healthy = 0,
    BelowTarget = 1,
    Critical = 2,
    Paused = 3,
}

/// Summary of threshold health across all managed reserves.
///
/// `at_or_above_threshold_count` counts reserves whose balance meets or exceeds
/// their target. `sweep_cooldown_ledgers` is a fixed constant exported here so
/// callers do not need to hard-code it separately.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagerThresholdSummary {
    pub total_assets: u32,
    pub healthy_count: u32,
    pub below_target_count: u32,
    pub critical_count: u32,
    pub at_or_above_threshold_count: u32,
    pub sweep_cooldown_ledgers: u32,
    pub is_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagerConfig {
    pub admin: Address,
    pub treasury: Address,
    pub is_paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveState {
    pub asset: Address,
    pub balance: i128,
    pub target_balance: i128,
    pub status: ReserveStatus,
    pub last_audit_ledger: u32,
}

/// Optional `ManagerConfig` wrapper for use inside `#[contracttype]` structs.
/// Soroban's XDR layer does not support `Option<CustomStruct>` as a field, so
/// an explicit two-variant enum is used instead.
///
/// Zero-state (contract not initialised): `OptionalManagerConfig::None`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OptionalManagerConfig {
    None,
    Some(ManagerConfig),
}

impl From<Option<ManagerConfig>> for OptionalManagerConfig {
    fn from(value: Option<ManagerConfig>) -> Self {
        match value {
            Some(config) => OptionalManagerConfig::Some(config),
            None => OptionalManagerConfig::None,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveSnapshot {
    pub config: OptionalManagerConfig,
    pub reserves: Vec<ReserveState>,
    pub ledger: u32,
}
