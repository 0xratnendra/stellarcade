//! Core data types for the lottery pot contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Share of the jackpot paid to the winner, in basis points (90%).
pub const WINNER_SHARE_BPS: i128 = 9_000;
/// Share of the jackpot rolled over to the next epoch, in basis points (10%).
pub const ROLLOVER_SHARE_BPS: i128 = 10_000 - WINNER_SHARE_BPS;

/// Grace period (in ledgers) after `draw_deadline_ledger` before
/// `emergency_refund` becomes available, giving the admin a window to call
/// `draw_winner` normally first. ~1 hour at 5s/ledger.
pub const EMERGENCY_REFUND_GRACE_LEDGERS: u32 = 720;

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
    TicketSalesClosed = 4,
    DrawNotYetAllowed = 5,
    AlreadyDrawn = 6,
    NotYetDrawn = 7,
    NoTicketsSold = 8,
    NotTheWinner = 9,
    AlreadyClaimed = 10,
    RefundNotAvailable = 11,
    NothingToRefund = 12,
    AlreadyRefunded = 13,
    /// The previous epoch was drawn, sold tickets, and still has an
    /// unclaimed jackpot; a new epoch cannot start until it is claimed.
    PreviousJackpotUnclaimed = 14,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    /// Current epoch id, incremented each time `start_lottery` is called.
    EpochId,
    // --- persistent(), keyed by epoch id ---
    Epoch(u64),
    /// Ticket purchase batches for `(epoch_id, player)`.
    PlayerTickets(u64, Address),
    /// Ordered list of ticket ranges sold this epoch, for resolving a
    /// winning ticket id back to its owning player.
    TicketRanges(u64),
    /// Whether `(epoch_id, player)` has claimed their emergency refund.
    Refunded(u64, Address),
}

// ---------------------------------------------------------------------------
// Epoch state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Epoch {
    pub id: u64,
    pub ticket_price: i128,
    /// Ledger sequence after which ticket sales close and a draw may occur.
    pub draw_deadline_ledger: u32,
    /// Total tickets sold this epoch (also the exclusive upper bound of
    /// valid ticket ids: valid ids are `0..tickets_sold`).
    pub tickets_sold: u64,
    /// Total pot for this epoch, including any rollover from the previous
    /// epoch's zero-ticket or unclaimed-refund case.
    pub pot: i128,
    pub drawn: bool,
    /// The winning ticket id, set once `draw_winner` succeeds with at
    /// least one ticket sold.
    pub winning_ticket_id: Option<u64>,
    pub jackpot_claimed: bool,
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
pub struct LotteryStarted {
    #[topic]
    pub epoch_id: u64,
    pub ticket_price: i128,
    pub draw_deadline_ledger: u32,
    pub starting_pot: i128,
}

#[contractevent]
pub struct TicketsPurchased {
    #[topic]
    pub epoch_id: u64,
    #[topic]
    pub player: Address,
    pub start_id: u64,
    pub count: u64,
}

#[contractevent]
pub struct WinnerDrawn {
    #[topic]
    pub epoch_id: u64,
    pub winning_ticket_id: u64,
}

#[contractevent]
pub struct EpochRolledOverEmpty {
    #[topic]
    pub epoch_id: u64,
    pub rolled_over_pot: i128,
}

#[contractevent]
pub struct JackpotClaimed {
    #[topic]
    pub epoch_id: u64,
    #[topic]
    pub winner: Address,
    pub winner_amount: i128,
    pub rollover_amount: i128,
}

#[contractevent]
pub struct EmergencyRefunded {
    #[topic]
    pub epoch_id: u64,
    #[topic]
    pub player: Address,
    pub amount: i128,
}
