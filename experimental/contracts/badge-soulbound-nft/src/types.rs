//! Core data types for the soulbound achievement badge contract.

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Name,
    Symbol,
    // --- persistent() ---
    /// A minted badge, keyed by (owner, badge_id).
    Badge(Address, u64),
}

/// Metadata for a single minted badge.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeInfo {
    pub metadata_uri: String,
    pub minted_at_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    BadgeNotFound = 4,
    BadgeAlreadyMinted = 5,
    NotTransferable = 6,
}
