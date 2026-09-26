use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// Ledgers both players have to reveal their bids (~1 hour at 5s/ledger).
pub const REVEAL_WINDOW_LEDGERS: u32 = 720;

/// Minimum staked wager for a duel.
pub const MIN_WAGER: i128 = 1_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DuelPhase {
    /// Creator posted a commitment, waiting for an opponent.
    Open,
    /// Both commitments locked; reveal window running.
    Committed,
    /// Both bids revealed and settled; escrow paid out.
    Finalized,
    /// A player failed to reveal; opponent won by forfeit.
    Forfeited,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    NextDuelId,
    Duel(u64),
}

/// A sealed-bid 1v1 high-roller match.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SealedDuel {
    pub duel_id: u64,
    pub creator: Address,
    pub opponent: Option<Address>,
    /// SHA256(wager_be_bytes || salt) posted at commit time.
    pub creator_commitment: BytesN<32>,
    pub opponent_commitment: Option<BytesN<32>>,
    /// Escrowed stake each side deposited with its commitment.
    pub stake: i128,
    /// Ledger at which the reveal window closes.
    pub reveal_deadline_ledger: u32,
    pub creator_reveal: Option<i128>,
    pub opponent_reveal: Option<i128>,
    pub winner: Option<Address>,
    pub settled: bool,
    pub phase: DuelPhase,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    DuelNotFound = 4,
    InvalidStake = 5,
    DuelNotOpen = 6,
    DuelNotCommitted = 7,
    AlreadyJoined = 8,
    RevealWindowClosed = 9,
    RevealWindowOpen = 10,
    AlreadyRevealed = 11,
    CommitmentMismatch = 12,
    AlreadyFinalized = 13,
    NotReadyToFinalize = 14,
}
