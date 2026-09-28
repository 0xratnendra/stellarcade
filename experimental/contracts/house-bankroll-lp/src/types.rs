//! Core data types for the house bankroll LP vault contract.

use soroban_sdk::{contracterror, contracttype, Address};

/// Cooldown between requesting a withdrawal and being able to claim the
/// underlying tokens back, in ledgers (~24 hours at 5s/ledger). Exists to
/// prevent liquidity providers from front-running large in-flight bets by
/// instantly pulling the bankroll out from under them.
pub const WITHDRAW_LOCKUP_LEDGERS: u32 = 17_280;

/// Performance fee taken out of net positive game yield before it is
/// credited to LP share value, in basis points (out of 10,000). 1_000 = 10%.
pub const PERFORMANCE_FEE_BPS: i128 = 1_000;

/// Fixed-point scale used by `get_share_price` so the price keeps
/// precision under integer division (plain integer division would floor
/// most real prices to 0 or 1).
pub const SHARE_PRICE_SCALE: i128 = 10_000_000;

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    TotalShares,
    TotalEquity,
    AdminFees,
    // --- persistent() ---
    /// Whether `Address` is an authorized game contract allowed to call
    /// `record_game_pnl`.
    GameAuthorized(Address),
    /// A liquidity provider's current share balance.
    Shares(Address),
    /// A liquidity provider's pending withdrawal request, if any.
    PendingWithdraw(Address),
}

/// A liquidity provider's pending withdrawal, locked until `claimable_at`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingWithdraw {
    pub amount: i128,
    pub claimable_at: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InsufficientShares = 5,
    WithdrawAlreadyPending = 6,
    NoPendingWithdraw = 7,
    LockupNotExpired = 8,
    Overflow = 9,
    InsufficientEquity = 10,
}
