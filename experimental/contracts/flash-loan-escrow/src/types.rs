//! Core data types for the flash loan escrow contract.

use soroban_sdk::{contracterror, contractevent, contracttype, Address};

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

pub const BPS_DENOMINATOR: u32 = 10_000;

/// Fixed-point scale for `FeeAccumulator`, chosen large enough that a
/// single loan's fee-per-share increment doesn't round to zero even
/// against a large `total_principal`.
pub const ACC_PRECISION: i128 = 1_000_000_000_000;

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
    InsufficientLiquidity = 4,
    LoanNotRepaid = 5,
    BorrowerCallbackFailed = 6,
    NoDeposit = 7,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    FeeBps,
    /// Total principal deposited by liquidity providers (excludes accrued
    /// fees, which are tracked separately per provider).
    TotalPrincipal,
    /// A provider's own deposited principal.
    ProviderPrincipal(Address),
    /// Cumulative fee-per-share accumulator, scaled by `ACC_PRECISION`.
    /// Bumped by `fee * ACC_PRECISION / total_principal` on every
    /// repaid flash loan, so a provider's earned-but-unclaimed fee share
    /// is computable in O(1) as `(acc - provider's last-seen acc) *
    /// provider_principal / ACC_PRECISION`, without iterating every
    /// provider on every loan (a standard "reward-per-share" accumulator
    /// pattern, the same shape as e.g. a yield-bearing vault's index).
    FeeAccumulator,
    /// A provider's own copy of `FeeAccumulator` as of their last
    /// deposit/withdrawal/claim, used to compute newly-earned fees since
    /// then.
    ProviderFeeAccChkpt(Address),
    /// A provider's already-settled (computed but not yet withdrawn) fee
    /// balance, updated whenever their principal changes or they claim.
    ProviderFeesEarned(Address),
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct LiquidityDeposited {
    #[topic]
    pub provider: Address,
    pub amount: i128,
    pub total_principal: i128,
}

#[contractevent]
pub struct LiquidityWithdrawn {
    #[topic]
    pub provider: Address,
    pub amount: i128,
}

#[contractevent]
pub struct FlashLoanExecuted {
    #[topic]
    pub borrower_contract: Address,
    pub amount: i128,
    pub fee: i128,
}
