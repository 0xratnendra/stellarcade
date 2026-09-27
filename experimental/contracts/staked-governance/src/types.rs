//! Core data types for the staked governance contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, String};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Cooldown (in ledgers) between requesting an unstake and being able to
/// claim the underlying tokens back. ~24 hours at 5s/ledger.
pub const UNSTAKE_COOLDOWN_LEDGERS: u32 = 17_280;

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
    InsufficientStake = 4,
    TokensCommittedToActiveVote = 5,
    NoPendingUnstake = 6,
    CooldownNotExpired = 7,
    ProposalNotFound = 8,
    VotingClosed = 9,
    AlreadyVoted = 10,
    QuorumNotReached = 11,
    AlreadyExecuted = 12,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Token,
    QuorumBps,
    ProposalCount,
    TotalStaked,
    // --- persistent() ---
    /// A voter's currently staked (voting-eligible) balance.
    Staked(Address),
    /// A voter's pending unstake request, if any.
    PendingUnstake(Address),
    /// The ledger sequence before which a voter's stake is locked, equal to
    /// the highest `end_ledger` among proposals they have voted on. Staked
    /// tokens cannot be unstaked while the current ledger is still before
    /// this value.
    LockedUntil(Address),
    /// Proposal keyed by proposal_id.
    Proposal(u64),
    /// Whether a voter has already voted on a given proposal_id.
    HasVoted(Address, u64),
}

// ---------------------------------------------------------------------------
// Vote type
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VoteType {
    For,
    Against,
    Abstain,
}

// ---------------------------------------------------------------------------
// Proposal state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub description: String,
    /// Ledger sequence after which voting closes.
    pub end_ledger: u32,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    pub executed: bool,
}

/// A voter's pending unstake request.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUnstake {
    pub amount: i128,
    /// Ledger sequence after which the unstake can be claimed.
    pub claimable_at: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct Staked {
    #[topic]
    pub voter: Address,
    pub amount: i128,
    pub total_staked: i128,
}

#[contractevent]
pub struct UnstakeRequested {
    #[topic]
    pub voter: Address,
    pub amount: i128,
    pub claimable_at: u32,
}

#[contractevent]
pub struct UnstakeClaimed {
    #[topic]
    pub voter: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ProposalCreated {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub proposer: Address,
    pub end_ledger: u32,
}

#[contractevent]
pub struct VoteCast {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub voter: Address,
    pub vote_type: VoteType,
    pub weight: i128,
}

#[contractevent]
pub struct ProposalExecuted {
    #[topic]
    pub proposal_id: u64,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
}
