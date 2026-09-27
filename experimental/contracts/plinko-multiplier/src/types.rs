//! Core data types for the plinko multiplier contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN};

/// Multiplier values are basis-100 integers (`100` == `1.0x`, `2900` ==
/// `29.0x`) to avoid floating point, matching this workspace's
/// `wheel-of-fortune` contract's own multiplier convention.
pub const MULTIPLIER_SCALE: u32 = 100;

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
    UnsupportedRowCount = 4,
    InvalidBinIndex = 5,
    WagerExceedsBankrollLimit = 6,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Bankroll,
    /// Running drop counter, used as a nonce in the commit-reveal path
    /// derivation so two drops with the same client_seed still resolve to
    /// independent paths.
    DropCount,
}

// ---------------------------------------------------------------------------
// Drop result
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DropResult {
    pub drop_id: u64,
    pub rows: u32,
    /// The final bin index the ball landed in, in `0..=rows`.
    pub bin_index: u32,
    /// Basis-100 multiplier applied to the wager (see `MULTIPLIER_SCALE`).
    pub multiplier_bps100: u32,
    pub wager: i128,
    pub payout: i128,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct BallDropped {
    #[topic]
    pub drop_id: u64,
    #[topic]
    pub player: Address,
    pub rows: u32,
    pub bin_index: u32,
    pub multiplier_bps100: u32,
    pub wager: i128,
    pub payout: i128,
}

/// A caller-supplied random seed, combined with the drop id, to
/// deterministically derive the ball's bounce path (see the module doc's
/// "Provable fairness" section in lib.rs).
pub type ClientSeed = BytesN<32>;
