//! Core data types for the milestone escrow contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

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
    NotOracle = 4,
    MilestoneNotConfigured = 5,
    MilestoneNotVerified = 6,
    AlreadyClaimed = 7,
    InsufficientPool = 8,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Oracle,
    Token,
    Pool,
    /// Reward amount for a given milestone id, configured by the admin.
    MilestoneReward(u64),
    // --- persistent() ---
    /// Set once an oracle has verified `(player, milestone_id)` as complete.
    Verified(Address, u64),
    /// Set once `(player, milestone_id)` has been claimed, to prevent
    /// double-spending.
    Claimed(Address, u64),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct PoolDeposited {
    #[topic]
    pub sponsor: Address,
    pub amount: i128,
}

#[contractevent]
pub struct MilestoneConfigured {
    #[topic]
    pub milestone_id: u64,
    pub reward: i128,
}

#[contractevent]
pub struct MilestoneVerified {
    #[topic]
    pub player: Address,
    #[topic]
    pub milestone_id: u64,
}

#[contractevent]
pub struct RewardClaimed {
    #[topic]
    pub player: Address,
    #[topic]
    pub milestone_id: u64,
    pub amount: i128,
}
