//! Core data types for the dice duel escrow contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN};

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
    NotThePendingOpponent = 3,
    WrongDuelState = 4,
    NotAParticipant = 5,
    AlreadyCommitted = 6,
    NoCommitmentFound = 7,
    CommitmentMismatch = 8,
    NotBothRevealed = 9,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    DuelCount,
    Duel(u64),
}

// ---------------------------------------------------------------------------
// Duel state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DuelStatus {
    /// Creator has locked their wager; awaiting the opponent's acceptance.
    Pending,
    /// Both players have locked their wager; awaiting both commitments.
    Committing,
    /// Both players have committed; awaiting both reveals.
    Revealing,
    /// Both players have revealed and rolled equal values; awaiting a
    /// re-roll (a fresh commit/reveal round) or a split via `settle_duel`.
    Tied,
    /// The duel has been settled: either swept to a winner, split on an
    /// unresolved tie, or cancelled and refunded.
    Settled,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DiceSides {
    D6,
    D20,
}

impl DiceSides {
    pub fn sides(self) -> u32 {
        match self {
            DiceSides::D6 => 6,
            DiceSides::D20 => 20,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Duel {
    pub id: u64,
    pub creator: Address,
    pub opponent: Address,
    pub token: Address,
    pub wager: i128,
    pub dice: DiceSides,
    pub status: DuelStatus,
    pub creator_commitment: Option<BytesN<32>>,
    pub opponent_commitment: Option<BytesN<32>>,
    pub creator_roll: Option<u32>,
    pub opponent_roll: Option<u32>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct DuelCreated {
    #[topic]
    pub duel_id: u64,
    #[topic]
    pub creator: Address,
    pub opponent: Address,
    pub wager: i128,
}

#[contractevent]
pub struct DuelAccepted {
    #[topic]
    pub duel_id: u64,
}

#[contractevent]
pub struct DuelCancelled {
    #[topic]
    pub duel_id: u64,
}

#[contractevent]
pub struct RollCommitted {
    #[topic]
    pub duel_id: u64,
    #[topic]
    pub player: Address,
}

#[contractevent]
pub struct RollRevealed {
    #[topic]
    pub duel_id: u64,
    #[topic]
    pub player: Address,
    pub value: u32,
}

#[contractevent]
pub struct DuelSettled {
    #[topic]
    pub duel_id: u64,
    /// `None` if the pot was split (unresolved tie).
    pub winner: Option<Address>,
    pub payout: i128,
}
