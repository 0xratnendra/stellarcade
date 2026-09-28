//! Core data types for the ticket raffle escrow contract.

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
    RaffleNotFound = 4,
    RaffleClosed = 5,
    MaxTicketsPerWalletExceeded = 6,
    DrawNotYetAllowed = 7,
    AlreadyDrawn = 8,
    NotYetDrawn = 9,
    NoTicketsSold = 10,
    AlreadyClaimed = 11,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    /// Next raffle id to be assigned by `create_raffle`.
    NextRaffleId,
    // --- persistent(), keyed by raffle id ---
    Raffle(u64),
    /// Ticket purchase batches for `(raffle_id, player)`.
    PlayerTickets(u64, Address),
    /// Ordered list of ticket ranges sold this raffle, for resolving a
    /// winning ticket id back to its owning player.
    TicketRanges(u64),
}

// ---------------------------------------------------------------------------
// Raffle state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Raffle {
    pub id: u64,
    pub admin: Address,
    pub ticket_price: i128,
    /// Unix timestamp after which ticket sales close and a draw may occur.
    pub end_time: u64,
    /// Maximum tickets a single wallet may hold in this raffle.
    pub max_tickets_per_wallet: u64,
    /// Total tickets sold so far (also the exclusive upper bound of valid
    /// ticket ids: valid ids are `0..tickets_sold`).
    pub tickets_sold: u64,
    /// Total prize pool accumulated from ticket sales.
    pub pool: i128,
    pub drawn: bool,
    /// The winning ticket id, set once `draw_winner` succeeds with at
    /// least one ticket sold.
    pub winning_ticket_id: Option<u64>,
    pub prize_claimed: bool,
}

/// A contiguous range of ticket ids `[start_id, start_id + count)` owned by
/// `player`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TicketRange {
    pub player: Address,
    pub start_id: u64,
    pub count: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct RaffleCreated {
    #[topic]
    pub raffle_id: u64,
    pub ticket_price: i128,
    pub end_time: u64,
    pub max_tickets_per_wallet: u64,
}

#[contractevent]
pub struct TicketsPurchased {
    #[topic]
    pub raffle_id: u64,
    #[topic]
    pub player: Address,
    pub start_id: u64,
    pub count: u64,
}

#[contractevent]
pub struct WinnerDrawn {
    #[topic]
    pub raffle_id: u64,
    #[topic]
    pub winner: Address,
    pub winning_ticket_id: u64,
    pub prize_amount: i128,
}
