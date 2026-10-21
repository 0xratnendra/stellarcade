//! Stellarcade Coin Flip Contract
//!
//! A 50/50 betting game integrated with the Random Generator contract.
//! Players pick Heads (0) or Tails (1), place a wager, and an oracle
//! resolves the outcome via the RNG contract's request/fulfill model.
//!
//! ## Game Flow
//! 1. Player calls `place_bet` → tokens transfer in, RNG requested, game stored.
//! 2. Oracle fulfills randomness on the RNG contract (off-chain step).
//! 3. Anyone calls `resolve_bet` → reads RNG result, settles payout.
//!
//! If the oracle never fulfills the request, the player can call
//! `cancel_stale_bet` once `RefundTimeoutLedgers` ledgers have passed since
//! the bet was placed to reclaim the full wager. A refunded game can never
//! be resolved afterwards, so a player gets either a refund or a payout,
//! never both.
//!
//! ## House Edge
//! Configured at init via `house_edge_bps` (basis points). A 250 bps edge
//! means a winning bet on a 100-token wager pays 195 tokens (2x minus 5%).
//! The remaining 5 tokens stay in the contract as house profit.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    token::TokenClient, Address, BytesN, Env, Vec,
};

// ---------------------------------------------------------------------------
// External Contract Client & Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FulfilledEntry {
    pub caller: Address,
    pub max: u64,
    pub server_seed: BytesN<32>,
    pub result: u64,
    pub commitment: BytesN<32>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RngError {
    RequestNotFound = 6,
}

#[contractclient(name = "RandomGeneratorClient")]
pub trait RandomGeneratorContract {
    fn request_random(env: Env, caller: Address, request_id: u64, max: u64)
        -> Result<(), RngError>;
    fn get_result(env: Env, caller: Address, request_id: u64) -> Result<FulfilledEntry, RngError>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Instance storage TTL in ledgers (~30 days at 5 s/ledger). Instance storage
/// holds the admin, token, RNG address and wager limits; if it were archived
/// every call would fail until someone restored it.
pub const INSTANCE_BUMP_LEDGERS: u32 = 518_400;

/// Instance TTL is only extended once it drops below this many ledgers (~15
/// days), so busy contracts do not pay for a bump on every call.
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 259_200;
const BASIS_POINTS_DIVISOR: i128 = 10_000;
pub const PLAYER_HISTORY_LIMIT: u32 = 10;

/// Heads = 0, Tails = 1. RNG result % 2 maps to this.
pub const HEADS: u32 = 0;
pub const TAILS: u32 = 1;

/// Default refund timeout set by `init`: about 24 hours at ~5 s per ledger.
pub const DEFAULT_REFUND_TIMEOUT_LEDGERS: u32 = 17_280;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    InvalidSide = 5,
    GameAlreadyExists = 6,
    GameNotFound = 7,
    GameAlreadyResolved = 8,
    RngNotFulfilled = 9,
    WagerTooLow = 10,
    WagerTooHigh = 11,
    Overflow = 12,
    InsufficientHouseLiquidity = 13,
    /// `cancel_stale_bet` was called before the refund timeout elapsed, or
    /// after the RNG request was fulfilled (call `resolve_bet` instead).
    RefundNotYetAvailable = 14,
    /// The game's wager was already refunded via `cancel_stale_bet`.
    GameRefunded = 15,
    InvalidConfig = 16,
    Paused = 17,
}

// ---------------------------------------------------------------------------
// Storage types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    RngContract,
    MinWager,
    MaxWager,
    HouseEdgeBps,
    Game(u64),
    PlayerRecentGames(Address),
    /// Running count of unresolved (active) games.
    ActiveGamesCount,
    /// Sum of wagers across all currently unresolved games.
    TotalActiveWager,
    /// Ledgers after `placed_at_ledger` before a player may cancel a bet
    /// whose randomness was never fulfilled.
    RefundTimeoutLedgers,
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoinFlipConfig {
    pub admin: Address,
    pub token: Address,
    pub rng_contract: Address,
    pub min_wager: i128,
    pub max_wager: i128,
    pub house_edge_bps: i128,
    pub paused: bool,
    pub refund_timeout_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player: Address,
    pub side: u32,
    pub wager: i128,
    pub resolved: bool,
    pub won: bool,
    pub payout: i128,
    /// Ledger sequence at which the bet was placed.
    pub placed_at_ledger: u32,
    /// True if the wager was returned via `cancel_stale_bet`.
    pub refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerGameHistoryPage {
    pub total: u32,
    pub start: u32,
    pub limit: u32,
    pub game_ids: Vec<u64>,
}

/// Snapshot of the house's current exposure across all unresolved games.
///
/// `max_payout_liability` is the maximum token amount the house must transfer
/// if every active game resolves in the player's favour.  The formula is:
///
/// ```text
/// max_payout_liability = total_wagered * (2 * 10_000 - house_edge_bps) / 10_000
/// ```
///
/// The value resets to zero naturally as games are resolved.  No admin action
/// is needed between rounds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HouseExposureSnapshot {
    /// Number of games that have been placed but not yet resolved.
    pub active_game_count: u32,
    /// Sum of all wagers across currently unresolved games.
    pub total_wagered: i128,
    /// Worst-case token payout if every active game is won by the player.
    pub max_payout_liability: i128,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct BetPlaced {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub side: u32,
    pub wager: i128,
}

#[contractevent]
pub struct BetResolved {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub won: bool,
    pub payout: i128,
}

#[contractevent]
pub struct BetRefunded {
    #[topic]
    pub game_id: u64,
    #[topic]
    pub player: Address,
    pub wager: i128,
}

#[contractevent]
pub struct HouseFunded {
    #[topic]
    pub admin: Address,
    pub amount: i128,
}

#[contractevent]
pub struct HouseWithdrawn {
    #[topic]
    pub admin: Address,
    pub amount: i128,
}

#[contractevent]
pub struct WagerLimitsUpdated {
    #[topic]
    pub admin: Address,
    pub min_wager: i128,
    pub max_wager: i128,
}

#[contractevent]
pub struct ContractPaused {
    #[topic]
    pub admin: Address,
    pub paused: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct CoinFlip;

#[contractimpl]
impl CoinFlip {
    /// Initialize the coin flip game.
    ///
    /// `house_edge_bps`: house edge in basis points (e.g., 250 = 2.5%).
    /// The refund timeout for `cancel_stale_bet` is set to
    /// `DEFAULT_REFUND_TIMEOUT_LEDGERS`.
    pub fn init(
        env: Env,
        admin: Address,
        rng_contract: Address,
        token: Address,
        min_wager: i128,
        max_wager: i128,
        house_edge_bps: i128,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        if min_wager <= 0
            || min_wager > max_wager
            || !(0..BASIS_POINTS_DIVISOR).contains(&house_edge_bps)
        {
            return Err(Error::InvalidConfig);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::RngContract, &rng_contract);
        env.storage().instance().set(&DataKey::MinWager, &min_wager);
        env.storage().instance().set(&DataKey::MaxWager, &max_wager);
        env.storage()
            .instance()
            .set(&DataKey::HouseEdgeBps, &house_edge_bps);
        env.storage().instance().set(
            &DataKey::RefundTimeoutLedgers,
            &DEFAULT_REFUND_TIMEOUT_LEDGERS,
        );
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Player places a bet. Tokens are transferred into the contract.
    /// A randomness request is submitted to the RNG contract.
    ///
    /// `side`: 0 = Heads, 1 = Tails.
    pub fn place_bet(
        env: Env,
        player: Address,
        side: u32,
        wager: i128,
        game_id: u64,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(Error::Paused);
        }
        player.require_auth();

        if side != HEADS && side != TAILS {
            return Err(Error::InvalidSide);
        }
        if wager <= 0 {
            return Err(Error::InvalidAmount);
        }

        let min_wager: i128 = env.storage().instance().get(&DataKey::MinWager).unwrap();
        let max_wager: i128 = env.storage().instance().get(&DataKey::MaxWager).unwrap();
        if wager < min_wager {
            return Err(Error::WagerTooLow);
        }
        if wager > max_wager {
            return Err(Error::WagerTooHigh);
        }

        let game_key = DataKey::Game(game_id);
        if env.storage().persistent().has(&game_key) {
            return Err(Error::GameAlreadyExists);
        }

        // Verify house has enough liquidity to cover this bet plus existing liability
        let total_wagered: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalActiveWager)
            .unwrap_or(0i128);
        let new_total_wagered = total_wagered.checked_add(wager).ok_or(Error::Overflow)?;
        let house_edge_bps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HouseEdgeBps)
            .unwrap();
        let max_payout_factor = (2 * BASIS_POINTS_DIVISOR)
            .checked_sub(house_edge_bps)
            .ok_or(Error::Overflow)?;
        let new_max_liability = new_total_wagered
            .checked_mul(max_payout_factor)
            .ok_or(Error::Overflow)?
            .checked_div(BASIS_POINTS_DIVISOR)
            .ok_or(Error::Overflow)?;

        let token = get_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let current_balance = token_client.balance(&env.current_contract_address());
        let total_available = current_balance.checked_add(wager).ok_or(Error::Overflow)?;

        if total_available < new_max_liability {
            return Err(Error::InsufficientHouseLiquidity);
        }

        // Transfer tokens from player to this contract
        token_client.transfer(&player, env.current_contract_address(), &wager);

        // Request randomness: max=2 gives result 0 or 1
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        RandomGeneratorClient::new(&env, &rng_addr).request_random(
            &env.current_contract_address(),
            &game_id,
            &2u64,
        );

        // Store game state
        let game = Game {
            player: player.clone(),
            side,
            wager,
            resolved: false,
            won: false,
            payout: 0,
            placed_at_ledger: env.ledger().sequence(),
            refunded: false,
        };
        env.storage().persistent().set(&game_key, &game);
        env.storage().persistent().extend_ttl(
            &game_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );
        push_recent_game(&env, &player, game_id);

        // Update aggregate exposure counters.
        add_active_exposure(&env, wager);

        BetPlaced {
            game_id,
            player,
            side,
            wager,
        }
        .publish(&env);
        Ok(())
    }

    /// Resolve a game after the oracle has fulfilled the RNG request.
    /// Anyone can call this — no auth needed since the outcome is deterministic.
    pub fn resolve_bet(env: Env, game_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;

        let game_key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&game_key)
            .ok_or(Error::GameNotFound)?;

        if game.refunded {
            return Err(Error::GameRefunded);
        }
        if game.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        // Read RNG result — panics if not yet fulfilled
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        let rng_client = RandomGeneratorClient::new(&env, &rng_addr);
        // Requests are namespaced by caller: this contract submitted the request.
        let fulfilled = rng_client.try_get_result(&env.current_contract_address(), &game_id);
        let entry = match fulfilled {
            Ok(Ok(e)) => e,
            _ => return Err(Error::RngNotFulfilled),
        };

        let outcome = entry.result as u32; // 0 or 1
        let won = outcome == game.side;

        let mut payout = 0i128;
        if won {
            let house_edge_bps: i128 = env
                .storage()
                .instance()
                .get(&DataKey::HouseEdgeBps)
                .unwrap();
            // Payout = 2 * wager - house edge on the winnings
            // Winnings = wager (the profit portion). Fee = winnings * edge / 10000.
            let fee = game
                .wager
                .checked_mul(house_edge_bps)
                .and_then(|v| v.checked_div(BASIS_POINTS_DIVISOR))
                .ok_or(Error::Overflow)?;
            payout = game
                .wager
                .checked_mul(2)
                .and_then(|v| v.checked_sub(fee))
                .ok_or(Error::Overflow)?;

            // Transfer winnings to player (state update before transfer for safety)
            game.won = true;
            game.payout = payout;
            game.resolved = true;
            env.storage().persistent().set(&game_key, &game);
            env.storage().persistent().extend_ttl(
                &game_key,
                PERSISTENT_BUMP_LEDGERS,
                PERSISTENT_BUMP_LEDGERS,
            );

            let token = get_token(&env);
            TokenClient::new(&env, &token).transfer(
                &env.current_contract_address(),
                &game.player,
                &payout,
            );
        } else {
            game.resolved = true;
            game.won = false;
            game.payout = 0;
            env.storage().persistent().set(&game_key, &game);
            env.storage().persistent().extend_ttl(
                &game_key,
                PERSISTENT_BUMP_LEDGERS,
                PERSISTENT_BUMP_LEDGERS,
            );
        }

        // Reduce aggregate exposure now that this game is settled.
        subtract_active_exposure(&env, game.wager);

        BetResolved {
            game_id,
            player: game.player,
            won,
            payout,
        }
        .publish(&env);

        Ok(())
    }

    /// Cancel a bet whose randomness was never fulfilled and refund the full
    /// wager to the player.
    ///
    /// Only the game's player may call this, and only once
    /// `RefundTimeoutLedgers` ledgers have passed since `placed_at_ledger`
    /// while the RNG request is still unfulfilled. If the RNG result is
    /// already available the call fails with `RefundNotYetAvailable`; the
    /// game must be settled with `resolve_bet` instead.
    pub fn cancel_stale_bet(env: Env, player: Address, game_id: u64) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        player.require_auth();

        let game_key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&game_key)
            .ok_or(Error::GameNotFound)?;

        if game.player != player {
            return Err(Error::NotAuthorized);
        }
        if game.refunded {
            return Err(Error::GameRefunded);
        }
        if game.resolved {
            return Err(Error::GameAlreadyResolved);
        }

        let timeout: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RefundTimeoutLedgers)
            .unwrap_or(DEFAULT_REFUND_TIMEOUT_LEDGERS);
        let refundable_at = game
            .placed_at_ledger
            .checked_add(timeout)
            .ok_or(Error::Overflow)?;
        if env.ledger().sequence() < refundable_at {
            return Err(Error::RefundNotYetAvailable);
        }

        // A fulfilled RNG request means the game can be settled normally.
        let rng_addr: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        if let Ok(Ok(_)) = RandomGeneratorClient::new(&env, &rng_addr)
            .try_get_result(&env.current_contract_address(), &game_id)
        {
            return Err(Error::RefundNotYetAvailable);
        }

        // Mark the game settled before moving tokens.
        game.resolved = true;
        game.refunded = true;
        game.won = false;
        game.payout = 0;
        env.storage().persistent().set(&game_key, &game);
        env.storage().persistent().extend_ttl(
            &game_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        subtract_active_exposure(&env, game.wager);

        let token = get_token(&env);
        TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &game.player,
            &game.wager,
        );

        BetRefunded {
            game_id,
            player: game.player,
            wager: game.wager,
        }
        .publish(&env);
        Ok(())
    }

    /// View a game's state.
    pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Game(game_id))
            .ok_or(Error::GameNotFound)
    }

    /// Return a bounded page of recent game ids for a player, ordered newest first.
    pub fn get_recent_games(
        env: Env,
        player: Address,
        start: u32,
        limit: u32,
    ) -> Result<PlayerGameHistoryPage, Error> {
        require_initialized(&env)?;

        let stored = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&DataKey::PlayerRecentGames(player))
            .unwrap_or(Vec::new(&env));
        let total = stored.len();
        let page_limit = if limit == 0 {
            PLAYER_HISTORY_LIMIT
        } else {
            core::cmp::min(limit, PLAYER_HISTORY_LIMIT)
        };

        let mut game_ids = Vec::new(&env);
        let end = core::cmp::min(total, start.saturating_add(page_limit));
        let mut idx = start;
        while idx < end {
            if let Some(game_id) = stored.get(idx) {
                game_ids.push_back(game_id);
            }
            idx += 1;
        }

        Ok(PlayerGameHistoryPage {
            total,
            start,
            limit: page_limit,
            game_ids,
        })
    }

    /// Return the current house exposure across all unresolved games.
    ///
    /// The snapshot is derived entirely from aggregate counters updated by
    /// `place_bet`, `resolve_bet` and `cancel_stale_bet`, so it requires no off-chain scanning.
    /// `max_payout_liability` reflects the worst-case payout if every active
    /// game is won by the player (after applying the configured house edge).
    /// Returns zeroed fields when no games are currently active.
    pub fn house_exposure_snapshot(env: Env) -> Result<HouseExposureSnapshot, Error> {
        require_initialized(&env)?;

        let active_game_count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ActiveGamesCount)
            .unwrap_or(0u32);
        let total_wagered: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalActiveWager)
            .unwrap_or(0i128);

        let max_payout_liability = if total_wagered == 0 {
            0i128
        } else {
            let house_edge_bps: i128 = env
                .storage()
                .instance()
                .get(&DataKey::HouseEdgeBps)
                .unwrap();
            // max payout = total_wagered * (20_000 - house_edge_bps) / 10_000
            total_wagered
                .checked_mul(
                    (2 * BASIS_POINTS_DIVISOR)
                        .checked_sub(house_edge_bps)
                        .ok_or(Error::Overflow)?,
                )
                .and_then(|v| v.checked_div(BASIS_POINTS_DIVISOR))
                .ok_or(Error::Overflow)?
        };

        Ok(HouseExposureSnapshot {
            active_game_count,
            total_wagered,
            max_payout_liability,
        })
    }

    /// Fund the house bankroll. Admin only.
    pub fn fund_house(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = get_token(&env);
        TokenClient::new(&env, &token).transfer(&admin, env.current_contract_address(), &amount);

        HouseFunded { admin, amount }.publish(&env);
        Ok(())
    }

    /// Withdraw from the house bankroll without dropping below current exposure liability. Admin only.
    pub fn withdraw_house(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let token = get_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let current_balance = token_client.balance(&env.current_contract_address());

        let exposure = Self::house_exposure_snapshot(env.clone())?;
        let min_required = exposure.max_payout_liability;

        let remaining = current_balance.checked_sub(amount).ok_or(Error::Overflow)?;

        if remaining < min_required {
            return Err(Error::InsufficientHouseLiquidity);
        }

        token_client.transfer(&env.current_contract_address(), &admin, &amount);

        HouseWithdrawn { admin, amount }.publish(&env);
        Ok(())
    }

    /// Read-only getter for the contract's token balance.
    pub fn house_balance(env: Env) -> Result<i128, Error> {
        require_initialized(&env)?;
        let token = get_token(&env);
        Ok(TokenClient::new(&env, &token).balance(&env.current_contract_address()))
    }

    /// Update minimum and maximum wager limits. Admin only.
    pub fn set_wager_limits(
        env: Env,
        admin: Address,
        min_wager: i128,
        max_wager: i128,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        if min_wager <= 0 || min_wager > max_wager {
            return Err(Error::InvalidConfig);
        }

        env.storage().instance().set(&DataKey::MinWager, &min_wager);
        env.storage().instance().set(&DataKey::MaxWager, &max_wager);

        WagerLimitsUpdated {
            admin,
            min_wager,
            max_wager,
        }
        .publish(&env);
        Ok(())
    }

    /// Pause or unpause contract operations. Admin only.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        env.storage().instance().set(&DataKey::Paused, &paused);

        ContractPaused { admin, paused }.publish(&env);
        Ok(())
    }

    /// Query the complete configuration snapshot of the contract.
    pub fn get_config(env: Env) -> Result<CoinFlipConfig, Error> {
        require_initialized(&env)?;

        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let rng_contract: Address = env.storage().instance().get(&DataKey::RngContract).unwrap();
        let min_wager: i128 = env.storage().instance().get(&DataKey::MinWager).unwrap();
        let max_wager: i128 = env.storage().instance().get(&DataKey::MaxWager).unwrap();
        let house_edge_bps: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HouseEdgeBps)
            .unwrap();
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        let refund_timeout_ledgers: u32 = env
            .storage()
            .instance()
            .get(&DataKey::RefundTimeoutLedgers)
            .unwrap_or(DEFAULT_REFUND_TIMEOUT_LEDGERS);

        Ok(CoinFlipConfig {
            admin,
            token,
            rng_contract,
            min_wager,
            max_wager,
            house_edge_bps,
            paused,
            refund_timeout_ledgers,
        })
    }

    /// Query whether the contract is currently paused.
    pub fn is_paused(env: Env) -> Result<bool, Error> {
        require_initialized(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false))
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Keep the instance entry (admin, token, RNG address, wager limits) alive.
/// Called first in every state-changing entry point.
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

fn require_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    let stored_admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    if admin != &stored_admin {
        return Err(Error::NotAuthorized);
    }
    admin.require_auth();
    Ok(())
}

fn get_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .expect("CoinFlip: token not set")
}

/// Increment aggregate exposure counters when a bet is placed.
fn add_active_exposure(env: &Env, wager: i128) {
    let count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ActiveGamesCount)
        .unwrap_or(0u32);
    let wagered: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalActiveWager)
        .unwrap_or(0i128);
    env.storage().instance().set(
        &DataKey::ActiveGamesCount,
        &count.checked_add(1).expect("Overflow"),
    );
    env.storage().instance().set(
        &DataKey::TotalActiveWager,
        &wagered.checked_add(wager).expect("Overflow"),
    );
}

/// Decrement aggregate exposure counters when a bet is resolved or refunded.
fn subtract_active_exposure(env: &Env, wager: i128) {
    let count: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ActiveGamesCount)
        .unwrap_or(0u32);
    let wagered: i128 = env
        .storage()
        .instance()
        .get(&DataKey::TotalActiveWager)
        .unwrap_or(0i128);
    env.storage()
        .instance()
        .set(&DataKey::ActiveGamesCount, &count.saturating_sub(1));
    env.storage()
        .instance()
        .set(&DataKey::TotalActiveWager, &wagered.saturating_sub(wager));
}

fn push_recent_game(env: &Env, player: &Address, game_id: u64) {
    let key = DataKey::PlayerRecentGames(player.clone());
    let existing = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));

    let mut updated = Vec::new(env);
    updated.push_back(game_id);

    let retained = core::cmp::min(existing.len(), PLAYER_HISTORY_LIMIT.saturating_sub(1));
    let mut idx = 0u32;
    while idx < retained {
        if let Some(old_game_id) = existing.get(idx) {
            updated.push_back(old_game_id);
        }
        idx += 1;
    }

    env.storage().persistent().set(&key, &updated);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
