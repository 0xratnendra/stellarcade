//! Core data types for the decaying Dutch auction contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, Symbol};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidInput = 2,
    AuctionClosed = 3,
    PriceExceedsMax = 4,
    NotSeller = 5,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Token,
    AuctionCount,
    Auction(u64),
}

// ---------------------------------------------------------------------------
// Auction state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Auction {
    pub id: u64,
    pub seller: Address,
    pub item_id: Symbol,
    pub start_price: i128,
    pub reserve_price: i128,
    pub start_time: u64,
    pub duration: u64,
    /// `true` once the item has been bought or the auction was cancelled.
    pub closed: bool,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct AuctionCreated {
    #[topic]
    pub auction_id: u64,
    #[topic]
    pub seller: Address,
    pub item_id: Symbol,
    pub start_price: i128,
    pub reserve_price: i128,
    pub duration: u64,
}

#[contractevent]
pub struct AuctionBought {
    #[topic]
    pub auction_id: u64,
    #[topic]
    pub buyer: Address,
    pub price_paid: i128,
}

#[contractevent]
pub struct AuctionCancelled {
    #[topic]
    pub auction_id: u64,
    #[topic]
    pub seller: Address,
}
