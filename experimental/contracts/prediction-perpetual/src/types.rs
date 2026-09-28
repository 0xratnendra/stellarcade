//! Core data types for the binary outcome prediction market.

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    MarketCount,
    // --- persistent() ---
    /// A market keyed by its auto-incrementing id.
    Market(u64),
    /// A player's bet in a given market.
    Bet(u64, Address),
}

/// A single binary (YES/NO) prediction market.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Market {
    /// The address permitted to resolve this market.
    pub oracle: Address,
    pub question: String,
    /// Unix timestamp after which betting closes and the market may be
    /// resolved.
    pub end_time: u64,
    pub yes_pool: i128,
    pub no_pool: i128,
    pub resolved: bool,
    /// `Some(true)` if YES won, `Some(false)` if NO won, `None` until
    /// resolved.
    pub winning_is_yes: Option<bool>,
}

/// A player's accumulated stake in a market, split by side.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct Bet {
    pub yes_amount: i128,
    pub no_amount: i128,
    pub claimed: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    MarketNotFound = 4,
    InvalidEndTime = 5,
    InvalidAmount = 6,
    MarketExpired = 7,
    MarketNotExpired = 8,
    AlreadyResolved = 9,
    NotResolved = 10,
    NoWinningStake = 11,
    AlreadyClaimed = 12,
    Overflow = 13,
}
