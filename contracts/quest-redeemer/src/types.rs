use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RedemptionStatus {
    Eligible = 0,
    Redeemed = 1,
    Expired = 2,
    NotStarted = 3,
    Paused = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedeemerConfig {
    pub admin: Address,
    pub quest_board: Address,
    pub token: Address,
    pub is_paused: bool,
}

/// Optional `RedeemerConfig` wrapper for use inside `#[contracttype]` structs.
/// Soroban's XDR layer does not support `Option<CustomStruct>` as a field, so
/// an explicit two-variant enum is used instead.
///
/// Zero-state (contract not initialised): `OptionalRedeemerConfig::None`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[allow(clippy::large_enum_variant)]
pub enum OptionalRedeemerConfig {
    None,
    Some(RedeemerConfig),
}

impl From<Option<RedeemerConfig>> for OptionalRedeemerConfig {
    fn from(value: Option<RedeemerConfig>) -> Self {
        match value {
            Some(config) => OptionalRedeemerConfig::Some(config),
            None => OptionalRedeemerConfig::None,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RedemptionSnapshot {
    pub config: OptionalRedeemerConfig,
    pub status: RedemptionStatus,
    pub user: Address,
    pub quest_id: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardGap {
    pub config: OptionalRedeemerConfig,
    pub status: RedemptionStatus,
    pub user: Address,
    pub quest_id: u32,
    pub reward_gap: u32,
    pub ready_to_turn_in: bool,
    pub timestamp: u64,
}
