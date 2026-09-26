use soroban_sdk::{contracterror, contracttype, Address};

/// Rolling volume window length in ledgers (~30 days at 5s/ledger).
pub const WINDOW_LEDGERS: u32 = 518_400;

/// Absolute fee floor: 25 bps (0.25%). No discount may go below this.
pub const MIN_FEE_BPS: u32 = 25;

/// Fee tiers: cumulative wager volume (in token units) required to reach each
/// tier and the effective fee in basis points. `Base` is the starting tier.
/// Base 2.00%, Bronze 1.50%, Silver 1.00%, Gold 0.50%.
pub const TIER_THRESHOLDS: [i128; 3] = [50_000_000_000, 500_000_000_000, 5_000_000_000_000];
pub const TIER_FEES_BPS: [u32; 4] = [200, 150, 100, 50];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    Player(Address),
    FeesCollected,
}

/// A player's rolling 30-day wager volume.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerVolume {
    /// Ledger at which the current window started.
    pub window_start_ledger: u32,
    /// Wager volume accumulated within the current window.
    pub total_volume: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientFees = 5,
}
