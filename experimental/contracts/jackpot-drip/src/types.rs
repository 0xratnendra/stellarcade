use soroban_sdk::{contracterror, contracttype, Address};

/// How long activity records and claims stay live in persistent storage.
pub const ACTIVITY_TTL_LEDGERS: u32 = 518_400; // ~30 days

/// Emergency sweep timelock: ledgers between requesting and executing (~10 days).
pub const SWEEP_TIMELOCK_LEDGERS: u32 = 172_800;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    DripRatePerLedger,
    DripPoolBalance,
    LastDripLedger,
    Players,
    Activity(Address),
    ClaimedThrough(Address),
    SweepRecipient,
    SweepEligibleAt,
}

/// A player's wager volume accrued in the current drip epoch.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerActivity {
    /// Wager volume recorded within the current window.
    pub volume: i128,
    /// Ledger of the player's last recorded activity (recency check).
    pub last_active_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidDripRate = 5,
    InsufficientPool = 6,
    NothingToClaim = 7,
    SweepNotRequested = 8,
    SweepTimelockActive = 9,
}
