use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// How long an issued access ticket stays valid, in ledgers (~1 hour at 5s/ledger).
pub const PASS_TTL_LEDGERS: u32 = 720;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    NftContract,
    Nonce,
    Pass(BytesN<32>),
}

/// A single-use, short-lived game access ticket.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessPass {
    /// Unique ticket id (also the key callers use with `validate_pass`).
    pub ticket_id: BytesN<32>,
    /// Player the ticket was issued to.
    pub player: Address,
    /// Ledger sequence at which this ticket expires.
    pub expires_at_ledger: u32,
    /// Cleared when the ticket is consumed by entering a restricted game.
    pub used: bool,
    /// Cleared when the underlying NFT is transferred away (revocation).
    pub revoked: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidNftContract = 4,
    NoNftBalance = 5,
    PassNotFound = 6,
    PassExpired = 7,
    PassAlreadyUsed = 8,
    PassRevoked = 9,
}
