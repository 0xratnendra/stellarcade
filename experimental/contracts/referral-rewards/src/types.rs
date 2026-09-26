//! Core data types for the referral rewards contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

pub const BPS_DENOMINATOR: u32 = 10_000;

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
    SelfReferralNotAllowed = 4,
    CircularReferralNotAllowed = 5,
    ReferrerAlreadySet = 6,
    NoReferrer = 7,
    NotAuthorizedCaller = 8,
    NothingToClaim = 9,
    InvalidTiers = 10,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    /// Tier schedule: index i's threshold is the MINIMUM active-referral
    /// count required to earn that tier's reward_bps.
    Tiers,
    /// Contracts authorized to call `record_wager_fee` (e.g. game
    /// contracts). Anyone could otherwise fabricate fee volume for an
    /// arbitrary player to inflate a referrer's earnings.
    AuthorizedCallers,
    /// A player's permanently bound referrer, if any.
    Referrer(Address),
    /// Number of players who have `referrer` as their bound referrer.
    ReferralCount(Address),
    /// A referrer's accumulated, unclaimed reward balance.
    Claimable(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardTier {
    /// Minimum number of active (bound) referrals required to earn this
    /// tier's reward share.
    pub min_referrals: u32,
    /// Reward share of wager fee volume, in basis points, e.g. `1_000` =
    /// 10%.
    pub reward_bps: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ReferrerRegistered {
    #[topic]
    pub player: Address,
    #[topic]
    pub referrer: Address,
}

#[contractevent]
pub struct WagerFeeRecorded {
    #[topic]
    pub player: Address,
    #[topic]
    pub referrer: Address,
    pub fee_amount: i128,
    pub reward_amount: i128,
}

#[contractevent]
pub struct ReferralEarningsClaimed {
    #[topic]
    pub referrer: Address,
    pub amount: i128,
}
