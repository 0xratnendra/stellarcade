//! Stellarcade Prize Pool Contract
//!
//! Acts as the shared treasury for all game payouts and fee routing.
//! Holds SEP-41 tokens deposited by funders, reserves amounts for active
//! games, and transfers winnings to verified recipients.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, Token address. Small, fixed-size contract config;
//!   all instance keys share one ledger entry and TTL.
//! - `persistent()`: Available, TotalReserved, and per-game Reservation entries.
//!   Each is a separate ledger entry with its own TTL, bumped on every write,
//!   so cost does not scale with total contract state.
//!
//! ## Invariant
//! `available + total_reserved == token.balance(contract_address)` at all
//! times, assuming all token inflows go through `fund`. Any direct transfer
//! to the contract address bypassing `fund` breaks this invariant.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient,
    Address, Env,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
/// Bumped on every write so active game data never expires mid-round.
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Instance storage TTL in ledgers (~30 days at 5 s/ledger). Instance storage
/// holds the admin and token address; if it were archived every call would
/// fail until someone restored it.
pub const INSTANCE_BUMP_LEDGERS: u32 = 518_400;

/// Instance TTL is only extended once it drops below this many ledgers (~15
/// days), so busy contracts do not pay for a bump on every call.
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 259_200;

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    InsufficientFunds = 5,
    GameAlreadyReserved = 6,
    ReservationNotFound = 7,
    PayoutExceedsReservation = 8,
    Overflow = 9,
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

/// Discriminants for all storage keys.
///
/// Instance keys (Admin, Token): contract config, one ledger entry.
/// Persistent keys (Available, TotalReserved, Reservation): accounting
/// counters and per-game entries, each with their own TTL.
#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Token,
    // --- persistent() ---
    /// Tokens currently available to be reserved for new games.
    Available,
    /// Running sum of all active per-game reservations.
    TotalReserved,
    /// Per-game reservation keyed by game_id.
    Reservation(u64),
    /// Cumulative count of all payouts processed.
    PayoutsCount,
    /// Sequence number of the last ledger that updated the contract state.
    LastUpdateLedger,
}

/// Per-game reservation record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReservationData {
    /// Original reserved amount; stored for auditability.
    pub total: i128,
    /// Amount remaining to be paid out or released.
    /// Starts equal to `total`; decremented by `payout` and `release`.
    pub remaining: i128,
}

/// Snapshot of the pool's accounting state returned by `get_pool_state`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolState {
    /// Tokens free to be earmarked for new games.
    pub available: i128,
    /// Tokens currently earmarked across all active reservations.
    pub reserved: i128,
}

/// Comprehensive snapshot of pool metrics for monitoring and analytics.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizePoolMetrics {
    /// Currently liquid tokens available for reservation.
    pub available_balance: i128,
    /// Sum of all active, unconsumed reservations.
    pub reserved_amount: i128,
    /// Lifetime count of successful payout transfers.
    pub payouts_count: u64,
    /// Ledger index of the most recent state change.
    pub last_update_ledger: u32,
}

/// Stable snapshot of admin/token configuration and basic pool metadata.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizePoolConfigSnapshot {
    pub admin: Address,
    pub token: Address,
    pub available_balance: i128,
    pub reserved_amount: i128,
    pub payouts_count: u64,
    pub last_update_ledger: u32,
}

/// Per-game reservation summary for frontend and backend payout views.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrizeAllocationSummary {
    pub game_id: u64,
    /// True when a reservation currently exists for the game.
    pub exists: bool,
    /// Original reserved amount; `0` when missing.
    pub total_allocated: i128,
    /// Amount already paid out or released from the reservation.
    pub amount_distributed: i128,
    /// Amount still reserved for future payouts or release.
    pub remaining_amount: i128,
    /// True when there is no remaining balance to claim against.
    pub fully_distributed: bool,
}

/// Aggregate payout-demand snapshot derived from tracked pool totals.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimPressure {
    pub available_balance: i128,
    pub reserved_amount: i128,
    /// `available + reserved`.
    pub tracked_balance: i128,
    /// `reserved / tracked_balance * 10_000`, rounded down.
    /// Returns `0` when tracked balance is zero.
    pub reserved_share_bps: u32,
    pub payouts_count: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct Funded {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct Reserved {
    #[topic]
    pub game_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct Released {
    #[topic]
    pub game_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct PaidOut {
    #[topic]
    pub to: Address,
    #[topic]
    pub game_id: u64,
    pub amount: i128,
}

#[contractevent]
pub struct Reconciled {
    #[topic]
    pub admin: Address,
    pub amount: i128,
    pub new_available: i128,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct PrizePool;

#[contractimpl]
impl PrizePool {
    // -----------------------------------------------------------------------
    // init
    // -----------------------------------------------------------------------

    /// Initialize the prize pool. May only be called once.
    ///
    /// `token` must be a deployed SEP-41 contract address (e.g., the USDC
    /// Stellar Asset Contract). All `fund` and `payout` operations transfer
    /// tokens through this contract exclusively.
    pub fn init(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        extend_instance_ttl(&env);

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);

        // Seed persistent counters so downstream reads never encounter None.
        set_persistent_i128(&env, DataKey::Available, 0);
        set_persistent_i128(&env, DataKey::TotalReserved, 0);
        set_persistent_u64(&env, DataKey::PayoutsCount, 0);
        set_persistent_u32(&env, DataKey::LastUpdateLedger, env.ledger().sequence());

        Ok(())
    }

    /// Rotate the admin address. Only the current admin may perform this action.
    pub fn rotate_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;
        new_admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // fund
    // -----------------------------------------------------------------------

    /// Transfer `amount` tokens from `from` into the pool.
    ///
    /// Any address may fund the pool (house top-up, admin, or a game contract
    /// forwarding a player's wager). The caller must sign an auth tree covering
    /// both this invocation and the downstream `token.transfer` sub-call.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        from.require_auth();

        let token = get_token(&env);
        TokenClient::new(&env, &token).transfer(&from, env.current_contract_address(), &amount);

        let new_available = get_available(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        set_persistent_i128(&env, DataKey::Available, new_available);

        update_markers(&env);
        Funded { from, amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // reserve
    // -----------------------------------------------------------------------

    /// Earmark `amount` tokens from the available pool for a specific game.
    ///
    /// Moves `amount` from `available` into a `Reservation(game_id)` entry.
    /// Calling reserve with a `game_id` that already has a reservation returns
    /// `GameAlreadyReserved` — this is the idempotency guard preventing a
    /// buggy game contract from double-drawing from the pool.
    pub fn reserve(env: Env, admin: Address, game_id: u64, amount: i128) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let res_key = DataKey::Reservation(game_id);
        if env.storage().persistent().has(&res_key) {
            return Err(Error::GameAlreadyReserved);
        }

        let available = get_available(&env);
        if amount > available {
            return Err(Error::InsufficientFunds);
        }

        let new_available = available.checked_sub(amount).ok_or(Error::Overflow)?;
        set_persistent_i128(&env, DataKey::Available, new_available);

        let new_total_reserved = get_total_reserved(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        set_persistent_i128(&env, DataKey::TotalReserved, new_total_reserved);

        let reservation = ReservationData {
            total: amount,
            remaining: amount,
        };
        env.storage().persistent().set(&res_key, &reservation);
        env.storage().persistent().extend_ttl(
            &res_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        update_markers(&env);
        Reserved { game_id, amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // release
    // -----------------------------------------------------------------------

    /// Return `amount` from a game's reservation back to the available pool.
    ///
    /// Used when a game ends with leftover funds (e.g., no winner, partial
    /// payout remainder, or game cancelled). A partial release (`amount <
    /// remaining`) is valid. When `remaining` reaches zero the reservation
    /// entry is removed to avoid stale storage.
    pub fn release(env: Env, admin: Address, game_id: u64, amount: i128) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let res_key = DataKey::Reservation(game_id);
        let mut reservation: ReservationData = env
            .storage()
            .persistent()
            .get(&res_key)
            .ok_or(Error::ReservationNotFound)?;

        if amount > reservation.remaining {
            return Err(Error::PayoutExceedsReservation);
        }

        reservation.remaining = reservation
            .remaining
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;

        let new_available = get_available(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        set_persistent_i128(&env, DataKey::Available, new_available);

        let new_total_reserved = get_total_reserved(&env)
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;
        set_persistent_i128(&env, DataKey::TotalReserved, new_total_reserved);

        if reservation.remaining == 0 {
            env.storage().persistent().remove(&res_key);
        } else {
            env.storage().persistent().set(&res_key, &reservation);
            env.storage().persistent().extend_ttl(
                &res_key,
                PERSISTENT_BUMP_LEDGERS,
                PERSISTENT_BUMP_LEDGERS,
            );
        }

        update_markers(&env);
        Released { game_id, amount }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // payout
    // -----------------------------------------------------------------------

    /// Transfer `amount` tokens to `to` from a game's reservation. Admin only.
    ///
    /// Multiple calls against the same `game_id` are permitted (e.g., one call
    /// per winner in a multi-winner game). Each call decrements `remaining`; the
    /// reservation is removed when `remaining` hits zero.
    ///
    /// All accounting state is updated BEFORE the external `token.transfer` to
    /// eliminate reentrancy risk: if the token call panics, state reflects the
    /// attempted debit, preventing a retry from double-paying.
    pub fn payout(
        env: Env,
        admin: Address,
        to: Address,
        game_id: u64,
        amount: i128,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let res_key = DataKey::Reservation(game_id);
        let mut reservation: ReservationData = env
            .storage()
            .persistent()
            .get(&res_key)
            .ok_or(Error::ReservationNotFound)?;

        if amount > reservation.remaining {
            return Err(Error::PayoutExceedsReservation);
        }

        reservation.remaining = reservation
            .remaining
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;

        let new_total_reserved = get_total_reserved(&env)
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;

        // Update all state before the external token transfer (reentrancy safety).
        set_persistent_i128(&env, DataKey::TotalReserved, new_total_reserved);

        if reservation.remaining == 0 {
            env.storage().persistent().remove(&res_key);
        } else {
            env.storage().persistent().set(&res_key, &reservation);
            env.storage().persistent().extend_ttl(
                &res_key,
                PERSISTENT_BUMP_LEDGERS,
                PERSISTENT_BUMP_LEDGERS,
            );
        }

        // Increment cumulative payout counter
        let count = get_payouts_count(&env);
        set_persistent_u64(&env, DataKey::PayoutsCount, count + 1);
        update_markers(&env);

        let token = get_token(&env);
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);

        PaidOut {
            to,
            game_id,
            amount,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // sync
    // -----------------------------------------------------------------------

    /// Reconcile the contract's accounting with its actual token balance.
    ///
    /// If tokens were sent directly to the contract address (bypassing `fund`),
    /// this method allows an admin to sync the `available` balance upward
    /// to restore the invariant: `available + total_reserved == balance`.
    ///
    /// This method only moves accounting UPWARD. It will not reduce `available`
    /// or touch `total_reserved` or any active reservations.
    pub fn sync(env: Env, admin: Address) -> Result<i128, Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        let token = get_token(&env);
        let actual_balance =
            TokenClient::new(&env, &token).balance(&env.current_contract_address());

        let available = get_available(&env);
        let reserved = get_total_reserved(&env);

        // Invariant: available + reserved == actual_balance
        // Delta = actual_balance - (available + reserved)
        let tracked_total = available.checked_add(reserved).ok_or(Error::Overflow)?;

        if actual_balance > tracked_total {
            let delta = actual_balance
                .checked_sub(tracked_total)
                .ok_or(Error::Overflow)?;
            let new_available = available.checked_add(delta).ok_or(Error::Overflow)?;

            set_persistent_i128(&env, DataKey::Available, new_available);
            update_markers(&env);

            Reconciled {
                admin: admin.clone(),
                amount: delta,
                new_available,
            }
            .publish(&env);

            Ok(delta)
        } else {
            // No-op if balance is already in sync or somehow lower (which shouldn't happen
            // unless tokens were burned/slashed externally, which we don't handle here).
            Ok(0)
        }
    }

    // -----------------------------------------------------------------------
    // Query Methods
    // -----------------------------------------------------------------------

    /// Returns a point-in-time snapshot of the pool's accounting state.
    pub fn get_pool_state(env: Env) -> Result<PoolState, Error> {
        require_initialized(&env)?;
        Ok(PoolState {
            available: get_available(&env),
            reserved: get_total_reserved(&env),
        })
    }

    /// Returns a detailed snapshot of the pool's metrics, including cumulative
    /// payout counts and last sequence markers.
    pub fn get_prize_pool_metrics(env: Env) -> Result<PrizePoolMetrics, Error> {
        require_initialized(&env)?;
        Ok(PrizePoolMetrics {
            available_balance: get_available(&env),
            reserved_amount: get_total_reserved(&env),
            payouts_count: get_payouts_count(&env),
            last_update_ledger: get_last_update_ledger(&env),
        })
    }

    /// Returns a stable configuration snapshot for backend consumers and operators.
    pub fn get_config_snapshot(env: Env) -> Result<PrizePoolConfigSnapshot, Error> {
        require_initialized(&env)?;
        Ok(PrizePoolConfigSnapshot {
            admin: get_admin(&env)?,
            token: get_token(&env),
            available_balance: get_available(&env),
            reserved_amount: get_total_reserved(&env),
            payouts_count: get_payouts_count(&env),
            last_update_ledger: get_last_update_ledger(&env),
        })
    }

    /// Returns a per-game reservation snapshot.
    ///
    /// Missing game ids return a zeroed response with `exists = false`.
    pub fn get_prize_allocation_summary(
        env: Env,
        game_id: u64,
    ) -> Result<PrizeAllocationSummary, Error> {
        require_initialized(&env)?;

        let reservation = env
            .storage()
            .persistent()
            .get::<_, ReservationData>(&DataKey::Reservation(game_id));

        Ok(match reservation {
            Some(reservation) => PrizeAllocationSummary {
                game_id,
                exists: true,
                total_allocated: reservation.total,
                amount_distributed: reservation.total.saturating_sub(reservation.remaining),
                remaining_amount: reservation.remaining,
                fully_distributed: reservation.remaining == 0,
            },
            None => PrizeAllocationSummary {
                game_id,
                exists: false,
                total_allocated: 0,
                amount_distributed: 0,
                remaining_amount: 0,
                fully_distributed: true,
            },
        })
    }

    /// Returns a contract-wide payout-demand summary.
    ///
    /// `reserved_share_bps` uses floor rounding and returns `0` when the pool
    /// has no tracked balance, which gives consumers a stable zero-value
    /// convention for empty or freshly initialized state.
    pub fn get_claim_pressure(env: Env) -> Result<ClaimPressure, Error> {
        require_initialized(&env)?;

        let available_balance = get_available(&env);
        let reserved_amount = get_total_reserved(&env);
        let tracked_balance = available_balance
            .checked_add(reserved_amount)
            .ok_or(Error::Overflow)?;

        let reserved_share_bps = if tracked_balance == 0 {
            0
        } else {
            ((reserved_amount * 10_000) / tracked_balance) as u32
        };

        Ok(ClaimPressure {
            available_balance,
            reserved_amount,
            tracked_balance,
            reserved_share_bps,
            payouts_count: get_payouts_count(&env),
        })
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Keep the instance entry (admin, token) alive. Called first in every
/// state-changing entry point.
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_LEDGERS);
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

/// Verify that `caller` is the stored admin and has signed the invocation.
fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin = get_admin(env)?;
    caller.require_auth();
    if caller != &admin {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("PrizePool: token not set")
}

fn get_available(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Available)
        .unwrap_or(0)
}

fn get_total_reserved(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalReserved)
        .unwrap_or(0)
}

fn get_payouts_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PayoutsCount)
        .unwrap_or(0)
}

fn get_last_update_ledger(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::LastUpdateLedger)
        .unwrap_or(0)
}

fn update_markers(env: &Env) {
    set_persistent_u32(env, DataKey::LastUpdateLedger, env.ledger().sequence());
}

/// Write an i128 to persistent storage and extend its TTL in one step.
fn set_persistent_i128(env: &Env, key: DataKey, value: i128) {
    env.storage().persistent().set(&key, &value);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

fn set_persistent_u64(env: &Env, key: DataKey, value: u64) {
    env.storage().persistent().set(&key, &value);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

fn set_persistent_u32(env: &Env, key: DataKey, value: u32) {
    env.storage().persistent().set(&key, &value);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
