//! Core data types for the royalty splitter contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, Vec};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

pub const BPS_DENOMINATOR: u32 = 10_000;

/// Delay (in ledgers) between proposing and executing a share update.
/// ~24 hours at 5s/ledger.
pub const SHARE_UPDATE_TIMELOCK_LEDGERS: u32 = 17_280;

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
    SharesMustSumToTenThousand = 4,
    MismatchedRecipientsAndShares = 5,
    NoPendingUpdate = 6,
    TimelockNotExpired = 7,
    NothingToClaim = 8,
    NotARecipient = 9,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Recipients,
    Shares,
    PendingUpdate,
    /// Claimable balance for `(recipient, token)`.
    Claimable(Address, Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingShareUpdate {
    pub recipients: Vec<Address>,
    pub shares: Vec<u32>,
    pub executable_at: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct SplitterInitialized {
    #[topic]
    pub admin: Address,
    pub recipient_count: u32,
}

#[contractevent]
pub struct RevenueDistributed {
    #[topic]
    pub token: Address,
    pub total_amount: i128,
    pub pushed: bool,
}

#[contractevent]
pub struct SharesClaimed {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ShareUpdateProposed {
    pub executable_at: u32,
}

#[contractevent]
pub struct ShareUpdateExecuted {
    pub recipient_count: u32,
}
