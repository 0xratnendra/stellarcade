//! Core data types for the time-locked wager contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Grace period (in ledgers) after a forfeit claim during which the
/// accused-of-abandoning player can dispute it before payout finalizes.
/// ~10 minutes at 5s/ledger.
pub const DISPUTE_GRACE_LEDGERS: u32 = 120;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidInput = 2,
    ChallengeExpired = 3,
    ChallengeNotExpired = 4,
    NotThePendingOpponent = 5,
    WrongChallengeState = 6,
    NotAParticipant = 7,
    TimeoutNotYetReached = 8,
    DisputeWindowExpired = 9,
    NotTheAccusedPlayer = 10,
}

// ---------------------------------------------------------------------------
// Challenge state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ChallengeStatus {
    /// Challenger has locked their wager; awaiting the opponent's
    /// acceptance before `response_deadline_ledger`.
    Pending,
    /// Both players have locked their wager; the match is considered
    /// in progress.
    Active,
    /// A forfeit was claimed against the OTHER player; within
    /// `dispute_deadline_ledger`, that player may dispute it to return the
    /// challenge to `Active`.
    ForfeitClaimed,
    /// The challenger reclaimed their wager after the opponent failed to
    /// accept before the response deadline. No fee.
    Cancelled,
    /// Final payout has been made (either by an undisputed forfeit claim,
    /// or by whatever future "both players agree on a winner" flow a game
    /// integration layers on top of this contract — out of scope here).
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Challenge {
    pub id: u64,
    pub challenger: Address,
    pub opponent: Address,
    pub token: Address,
    pub wager: i128,
    pub status: ChallengeStatus,
    /// Ledger sequence after which an unaccepted challenge may be
    /// cancelled by the challenger.
    pub response_deadline_ledger: u32,
    /// Set once accepted: the ledger sequence after which a
    /// timeout-forfeit may be claimed against an unresponsive opponent.
    /// `None` while still `Pending`.
    pub match_timeout_ledger: Option<u32>,
    // Forfeit claim fields, set together and cleared together (see
    // lib.rs's claim_timeout_forfeit/dispute_forfeit). Flattened as
    // separate fields on Challenge rather than a nested ForfeitClaim
    // struct; this repo's own soroban-sdk version enforces a 30-character
    // limit on #[contracttype] struct field names (surfaces as a
    // confusing cascading TryFromVal trait-bound error, not a clear "name
    // too long" message, if a name exceeds it — a naming pitfall to watch
    // for, unrelated to nesting depth).
    /// The address of the player the forfeit was claimed AGAINST (the
    /// allegedly-inactive one).
    pub forfeit_accused: Option<Address>,
    /// The address that claimed the forfeit.
    pub forfeit_claimant: Option<Address>,
    /// Ledger sequence after which an outstanding forfeit claim finalizes
    /// if undisputed.
    pub forfeit_dispute_deadline: Option<u32>,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    ChallengeCount,
    Challenge(u64),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ChallengeCreated {
    #[topic]
    pub challenge_id: u64,
    #[topic]
    pub challenger: Address,
    pub opponent: Address,
    pub wager: i128,
    pub response_deadline_ledger: u32,
}

#[contractevent]
pub struct ChallengeAccepted {
    #[topic]
    pub challenge_id: u64,
    pub match_timeout_ledger: u32,
}

#[contractevent]
pub struct ChallengeCancelled {
    #[topic]
    pub challenge_id: u64,
}

#[contractevent]
pub struct ForfeitClaimed {
    #[topic]
    pub challenge_id: u64,
    #[topic]
    pub claimant: Address,
    pub accused: Address,
    pub dispute_deadline_ledger: u32,
}

#[contractevent]
pub struct ForfeitDisputed {
    #[topic]
    pub challenge_id: u64,
}

#[contractevent]
pub struct ForfeitFinalized {
    #[topic]
    pub challenge_id: u64,
    #[topic]
    pub winner: Address,
    pub payout: i128,
}
