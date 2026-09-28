//! Core data types for the clan vault staking contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, String};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Valid lockup durations, in seconds: 30, 90, and 180 days.
pub const LOCK_TIER_30D: u64 = 30 * 86_400;
pub const LOCK_TIER_90D: u64 = 90 * 86_400;
pub const LOCK_TIER_180D: u64 = 180 * 86_400;

/// Dividend-weight multiplier per lock tier, in basis points (10_000 =
/// 1.0x). Longer commitments earn a proportionally larger slice of any
/// dividend distribution for the same staked amount.
pub const MULTIPLIER_30D_BPS: u128 = 10_000; // 1.0x
pub const MULTIPLIER_90D_BPS: u128 = 12_000; // 1.2x
pub const MULTIPLIER_180D_BPS: u128 = 15_000; // 1.5x

/// Returns the dividend-weight multiplier (basis points) for a lock
/// duration, or `None` if `duration` is not one of the three valid tiers.
pub fn multiplier_bps_for_duration(duration: u64) -> Option<u128> {
    match duration {
        LOCK_TIER_30D => Some(MULTIPLIER_30D_BPS),
        LOCK_TIER_90D => Some(MULTIPLIER_90D_BPS),
        LOCK_TIER_180D => Some(MULTIPLIER_180D_BPS),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidInput = 3,
    ClanAlreadyExists = 4,
    ClanNotFound = 5,
    InvalidLockDuration = 6,
    StakeNotFound = 7,
    LockNotYetExpired = 8,
    NotClanLeader = 9,
    NothingToClaim = 10,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Token,
    // --- persistent() ---
    Clan(String),
    /// A member's stake within a clan.
    Stake(String, Address),
    /// A member's claimable (already-distributed, not-yet-claimed)
    /// dividend balance within a clan.
    Claimable(String, Address),
    /// Every distinct address that currently has an active stake in this
    /// clan, so `distribute_dividends` can enumerate stakers to split a
    /// distribution proportionally. Soroban has no native way to enumerate
    /// persistent keys, so this index is maintained explicitly: appended
    /// to on a member's first stake, removed from on `unstake`.
    ClanMembers(String),
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Clan {
    pub clan_id: String,
    pub leader: Address,
    /// Sum of every active stake's `amount` in this clan (principal only,
    /// not dividend-weighted).
    pub total_staked: i128,
    /// Sum of every active stake's dividend weight
    /// (`amount * multiplier_bps`), used as the denominator when splitting
    /// a dividend distribution proportionally.
    pub total_weight: u128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberStake {
    pub member: Address,
    pub clan_id: String,
    pub amount: i128,
    pub duration: u64,
    pub multiplier_bps: u128,
    pub staked_at: u64,
    pub unlock_at: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ClanCreated {
    #[topic]
    pub clan_id: String,
    #[topic]
    pub leader: Address,
}

#[contractevent]
pub struct Staked {
    #[topic]
    pub clan_id: String,
    #[topic]
    pub member: Address,
    pub amount: i128,
    pub duration: u64,
    pub unlock_at: u64,
}

#[contractevent]
pub struct DividendsDistributed {
    #[topic]
    pub clan_id: String,
    pub reward_amount: i128,
}

#[contractevent]
pub struct DividendsClaimed {
    #[topic]
    pub clan_id: String,
    #[topic]
    pub member: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Unstaked {
    #[topic]
    pub clan_id: String,
    #[topic]
    pub member: Address,
    pub amount: i128,
}
