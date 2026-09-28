//! Core data types for the coin flip verifiable escrow contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// How long, in seconds, a player who has revealed their seed must wait
/// for the counterparty to reveal theirs before `claim_timeout` becomes
/// available. ~1 hour at Stellar's ~5s ledger close time.
pub const REVEAL_WINDOW_SECONDS: u64 = 3_600;

/// Basis-point denominator: `fee_bps` is out of 10_000 (100.00%).
pub const BPS_DENOMINATOR: i128 = 10_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    InvalidInput = 2,
    AlreadyInitialized = 3,
    NotInitialized = 4,
    WrongGameState = 5,
    NotAParticipant = 6,
    CommitmentMismatch = 8,
    AlreadyRevealed = 9,
    TimeoutNotReached = 10,
    NoRevealYet = 11,
    CounterpartyAlreadyRevealed = 12,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Config,
    GameCount,
    Game(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub token: Address,
    /// House fee, in basis points (out of 10_000), taken from the pot on
    /// a normal (both-revealed) settlement. Timeout settlements are not
    /// charged a fee — the honest player receives the full pot as
    /// compensation.
    pub fee_bps: u32,
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CoinSide {
    Heads,
    Tails,
}

impl CoinSide {
    pub fn opposite(self) -> CoinSide {
        match self {
            CoinSide::Heads => CoinSide::Tails,
            CoinSide::Tails => CoinSide::Heads,
        }
    }
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    /// Player 1 has locked their wager and named their commitment;
    /// awaiting player 2 to join.
    Pending,
    /// Both players have locked wagers and committed; awaiting both
    /// reveals.
    Revealing,
    /// The game has been settled: swept to the winner (normal resolution
    /// or a timeout claim).
    Settled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub id: u64,
    pub player1: Address,
    pub player2: Option<Address>,
    pub wager: i128,
    /// Player 1's called side. Player 2 is implicitly the opposite side
    /// — a coin flip only has two outcomes, so there is nothing for
    /// player 2 to separately call.
    pub choice: CoinSide,
    pub commit1: BytesN<32>,
    pub commit2: Option<BytesN<32>>,
    pub salt1: Option<BytesN<32>>,
    pub salt2: Option<BytesN<32>>,
    pub status: GameStatus,
    /// Ledger timestamp (seconds) after which `claim_timeout` becomes
    /// available to whichever player has already revealed. Set once both
    /// players have joined and the game enters `Revealing`.
    pub reveal_deadline: Option<u64>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct GameCreated {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player1: Address,
    pub wager: i128,
}

#[contractevent]
pub struct GameJoined {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player2: Address,
}

#[contractevent]
pub struct SeedRevealed {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
}

#[contractevent]
pub struct GameSettled {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub winner: Address,
    pub payout: i128,
    /// `true` if this was a timeout claim rather than a normal
    /// both-revealed resolution.
    pub via_timeout: bool,
}
