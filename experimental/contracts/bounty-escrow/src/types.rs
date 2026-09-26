//! Core data types for the community bounty escrow contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN, Symbol, Vec};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

pub const BPS_DENOMINATOR: u32 = 10_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidInput = 2,
    InvalidTiers = 3,
    NotAuthorizedVerifier = 4,
    BountyExpired = 5,
    BountyNotExpired = 6,
    AlreadyRefunded = 7,
    NoClaimSubmitted = 8,
    ScoreBelowLowestTier = 9,
    TierAlreadyPaid = 10,
    ClaimNotFound = 11,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Token,
    BountyCount,
    Bounty(u64),
    /// The most recent claim submitted for a bounty, keyed by bounty_id.
    /// Overwritten by a new submission; a bounty holds at most one
    /// outstanding (unverified) claim at a time.
    Claim(u64),
}

// ---------------------------------------------------------------------------
// Bounty state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BountyTier {
    /// Minimum score required to unlock this tier.
    pub score_threshold: u32,
    /// Cumulative share of the bounty's total amount this tier pays out,
    /// in basis points. Tiers must be sorted ascending by
    /// `score_threshold`, and their `payout_bps` values must also be
    /// non-decreasing (a higher tier can never pay a smaller cumulative
    /// share than a lower one it supersedes) and the highest tier's
    /// `payout_bps` must equal exactly `BPS_DENOMINATOR`.
    pub payout_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bounty {
    pub id: u64,
    pub sponsor: Address,
    pub target_game: Symbol,
    pub amount: i128,
    /// Cumulative amount already paid out across all approved claims so
    /// far (never exceeds `amount`).
    pub paid_out: i128,
    /// The highest tier index (into `tiers`) already paid, or `None` if no
    /// tier has been paid yet. Prevents re-paying a tier a player already
    /// unlocked and prevents a later, lower-scoring claim from "unpaying"
    /// progress.
    pub highest_tier_paid: Option<u32>,
    pub tiers: Vec<BountyTier>,
    pub deadline_ledger: u32,
    pub verifier: Address,
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub player: Address,
    pub proof_hash: BytesN<32>,
    pub claimed_score: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct BountyPosted {
    #[topic]
    pub bounty_id: u64,
    #[topic]
    pub sponsor: Address,
    pub amount: i128,
    pub deadline_ledger: u32,
}

#[contractevent]
pub struct ClaimSubmitted {
    #[topic]
    pub bounty_id: u64,
    #[topic]
    pub player: Address,
    pub claimed_score: u32,
}

#[contractevent]
pub struct BountyApproved {
    #[topic]
    pub bounty_id: u64,
    #[topic]
    pub player: Address,
    pub amount_paid: i128,
    pub tier_index: u32,
}

#[contractevent]
pub struct BountyRefunded {
    #[topic]
    pub bounty_id: u64,
    #[topic]
    pub sponsor: Address,
    pub amount: i128,
}
