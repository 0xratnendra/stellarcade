//! Core data types for the escrow arbitration multisig contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, Vec};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Total arbiter service commission deducted from the wager pool before
/// payout, in basis points (2%), split evenly across the 3 registered
/// arbiters regardless of how they voted.
pub const ARBITER_FEE_BPS: i128 = 200;

/// A ruling an arbiter can cast: either player wins the full (post-fee)
/// wager pool, or the match is ruled a tie/invalidation and the pool is
/// split evenly between both players.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Ruling {
    Winner(Address),
    Split,
}

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
    DisputeNotFound = 4,
    NotARegisteredArbiter = 5,
    ArbiterAlreadyVoted = 6,
    DisputeAlreadySettled = 7,
    NoRulingConsensusYet = 8,
    InvalidRuling = 9,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Token,
    /// Next dispute id to be assigned by `create_dispute`.
    NextDisputeId,
    // --- persistent(), keyed by dispute id ---
    Dispute(u64),
    /// `(dispute_id, arbiter)` -> the ruling that arbiter cast, if any.
    Vote(u64, Address),
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub dispute_id: u64,
    pub p1: Address,
    pub p2: Address,
    /// Wager amount each player deposited (so the total pool is `2 * wager`).
    pub wager: i128,
    pub arbiters: Vec<Address>,
    pub settled: bool,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct DisputeCreated {
    #[topic]
    pub dispute_id: u64,
    #[topic]
    pub p1: Address,
    #[topic]
    pub p2: Address,
    pub wager: i128,
}

#[contractevent]
pub struct VoteCast {
    #[topic]
    pub dispute_id: u64,
    #[topic]
    pub arbiter: Address,
}

#[contractevent]
pub struct RulingExecuted {
    #[topic]
    pub dispute_id: u64,
    pub arbiter_fee_total: i128,
}
