//! Core data types for the subscription pass contract.

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
    NoActivePass = 4,
    InvalidTier = 5,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    PassCost,
    DurationLedgers,
    /// Extra ledgers a VIP tier adds on top of `DurationLedgers` for each
    /// purchase/renewal, keyed by tier id (0 = base tier, no bonus).
    TierBonus(u32),
    // --- persistent() ---
    /// Pass record keyed by player address.
    Pass(Address),
}

// ---------------------------------------------------------------------------
// Pass state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PassRecord {
    pub player: Address,
    /// Ledger sequence at which the current membership window expires.
    pub expiry_ledger: u32,
    /// VIP tier id applied at the most recent purchase/renewal (0 = base).
    pub tier: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct PassPurchased {
    #[topic]
    pub player: Address,
    pub expiry_ledger: u32,
    pub tier: u32,
}

#[contractevent]
pub struct PassRenewed {
    #[topic]
    pub player: Address,
    pub expiry_ledger: u32,
}

#[contractevent]
pub struct TierConfigured {
    #[topic]
    pub tier: u32,
    pub bonus_ledgers: u32,
}
