//! Core data types for the progressive jackpot vault contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidInput = 1,
    AlreadyInitialized = 2,
    NotInitialized = 3,
    Unauthorized = 4,
    GameNotWhitelisted = 5,
    GameAlreadyWhitelisted = 6,
    EmptyPot = 7,
    InsufficientPot = 8,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Config,
    Pot,
    /// Whitelisted game contract address -> `()` (presence = whitelisted).
    Whitelist(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    /// The pot's floor after a Mega jackpot is won and the reserve is
    /// re-seeded.
    pub seed_amount: i128,
}

// ---------------------------------------------------------------------------
// Jackpot tiers
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum JackpotTier {
    /// Pays out 10% of the current pot.
    Mini,
    /// Pays out 50% of the current pot.
    Major,
    /// Pays out 100% of the current pot, then re-seeds the reserve back
    /// to `seed_amount`.
    Mega,
}

impl JackpotTier {
    /// Payout percentage, as a whole number out of 100.
    pub fn percent(self) -> i128 {
        match self {
            JackpotTier::Mini => 10,
            JackpotTier::Major => 50,
            JackpotTier::Mega => 100,
        }
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct VaultInitialized {
    #[topic]
    pub admin: Address,
    pub seed_amount: i128,
}

#[contractevent]
pub struct GameAdded {
    #[topic]
    pub game_address: Address,
}

#[contractevent]
pub struct Contributed {
    #[topic]
    pub game_address: Address,
    pub amount: i128,
    pub new_pot: i128,
}

#[contractevent]
pub struct JackpotClaimed {
    #[topic]
    pub game_address: Address,
    #[topic]
    pub winner: Address,
    pub tier_percent: i128,
    pub payout: i128,
    pub new_pot: i128,
}
