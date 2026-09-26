//! Plinko Multiplier
//!
//! A pegboard drop game. A ball falls through `rows` rows of pegs,
//! bouncing left or right at each row, and lands in one of `rows + 1`
//! bins at the bottom; each bin pays a fixed multiplier of the wager,
//! symmetric around the center (edge bins pay the highest multiplier,
//! center bins pay less than 1x, matching real Plinko house-edge design).
//!
//! ## Provable fairness
//!
//! The ball's bounce path is derived from `sha256(client_seed ||
//! drop_id_be)`, matching this workspace's `wheel-of-fortune` contract's
//! commit-reveal derivation pattern (see
//! `experimental/contracts/wheel-of-fortune/src/lib.rs`'s
//! `derive_segment_index`): the player supplies `client_seed` at drop
//! time, and the outcome is a pure, deterministic function of that seed
//! plus the drop's own sequential id (so the same seed used twice by the
//! same player still resolves independently, since `drop_id` differs).
//! There is no separate server-secret reveal phase here, unlike
//! `wheel-of-fortune`: a plinko drop resolves fully within one
//! transaction, so there is nothing to commit to before revealing — the
//! wager itself, submitted alongside `client_seed` in the same call, is
//! the commitment.
//!
//! ## Multiplier table
//!
//! For `rows` rows there are `rows + 1` bins, indexed `0..=rows`, with the
//! center at `rows / 2`. A bin's multiplier is a function of its distance
//! from center: the two edge bins (distance = `rows / 2`) pay the highest
//! multiplier for that row count (`EDGE_MULTIPLIER_BPS100`, scaled up for
//! higher row counts since edge bins are exponentially less likely to be
//! hit on a larger board), decreasing toward the center bin(s)
//! (`CENTER_MULTIPLIER_BPS100`, below 1x, since the binomial distribution
//! makes center bins the most likely outcome by far). See
//! `bin_multiplier_bps100` for the exact interpolation.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, bankroll, and the drop counter. Small,
//!   shared config.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, Vec};

use types::{BallDropped, MULTIPLIER_SCALE};
pub use types::{ClientSeed, DropResult, Error};

/// Edge-bin multiplier (basis-100) for each supported row count. Larger
/// boards have exponentially rarer edge outcomes, so they pay more.
fn edge_multiplier_bps100(rows: u32) -> u32 {
    match rows {
        8 => 1_000,  // 10x
        12 => 2_500, // 25x
        16 => 5_000, // 50x
        _ => 0,
    }
}

/// Center-bin multiplier (basis-100) for each supported row count.
fn center_multiplier_bps100(rows: u32) -> u32 {
    match rows {
        8 => 50,  // 0.5x
        12 => 30, // 0.3x
        16 => 20, // 0.2x
        _ => 0,
    }
}

fn is_supported_row_count(rows: u32) -> bool {
    matches!(rows, 8 | 12 | 16)
}

/// Linear interpolation between the center multiplier and the edge
/// multiplier, by a bin's distance from center relative to the maximum
/// possible distance (`rows / 2`).
fn bin_multiplier_bps100(rows: u32, bin_index: u32) -> u32 {
    let center = rows / 2;
    let distance = bin_index.abs_diff(center);
    let max_distance = center;

    if max_distance == 0 {
        return center_multiplier_bps100(rows);
    }

    let center_mult = center_multiplier_bps100(rows) as i128;
    let edge_mult = edge_multiplier_bps100(rows) as i128;
    let interpolated =
        center_mult + (edge_mult - center_mult) * distance as i128 / max_distance as i128;
    interpolated.max(0) as u32
}

/// Return the full bin -> multiplier table for `rows`, indices `0..=rows`.
pub fn bin_multiplier_table(env: &Env, rows: u32) -> Vec<u32> {
    let mut table = Vec::new(env);
    for bin in 0..=rows {
        table.push_back(bin_multiplier_bps100(rows, bin));
    }
    table
}

/// Derive the ball's final bin index from `sha256(client_seed ||
/// drop_id_be)`: each of the low `rows` bits of the digest determines one
/// row's bounce (0 = left, 1 = right), and the bin index is the count of
/// "right" bounces (a standard binomial/Galton-board path model).
fn derive_bin_index(env: &Env, client_seed: &ClientSeed, drop_id: u64, rows: u32) -> u32 {
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&client_seed.to_array());
    preimage[32..].copy_from_slice(&drop_id.to_be_bytes());

    let digest: soroban_sdk::BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage))
        .into();
    let bytes = digest.to_array();

    let mut right_bounces = 0u32;
    for row in 0..rows {
        let byte = bytes[(row / 8) as usize];
        let bit = (byte >> (row % 8)) & 1;
        right_bounces += bit as u32;
    }
    right_bounces
}

#[contract]
pub struct PlinkoMultiplier;

#[contractimpl]
impl PlinkoMultiplier {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        house_bankroll: i128,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if house_bankroll <= 0 {
            return Err(Error::InvalidInput);
        }

        admin.require_auth();

        let token_client = token::Client::new(&env, &token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&admin, &contract_address, &house_bankroll);

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_bankroll(&env, house_bankroll);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // drop_ball
    // -----------------------------------------------------------------------

    /// Drop a ball for `wager`, using `client_seed` (see the module doc's
    /// "Provable fairness" section) to deterministically resolve the
    /// bounce path on a `rows`-row board. Rejects the wager outright,
    /// before any funds move, if the worst-case payout (the edge-bin
    /// multiplier) would exceed the house bankroll.
    pub fn drop_ball(
        env: Env,
        player: Address,
        wager: i128,
        client_seed: ClientSeed,
        rows: u32,
    ) -> Result<DropResult, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        if wager <= 0 {
            return Err(Error::InvalidInput);
        }
        if !is_supported_row_count(rows) {
            return Err(Error::UnsupportedRowCount);
        }

        let max_multiplier = edge_multiplier_bps100(rows) as i128;
        let max_possible_payout = wager
            .checked_mul(max_multiplier)
            .and_then(|v| v.checked_div(MULTIPLIER_SCALE as i128))
            .ok_or(Error::InvalidInput)?;
        if max_possible_payout > storage::get_bankroll(&env) {
            return Err(Error::WagerExceedsBankrollLimit);
        }

        let drop_id = storage::next_drop_id(&env);
        let bin_index = derive_bin_index(&env, &client_seed, drop_id, rows);
        let multiplier_bps100 = bin_multiplier_bps100(rows, bin_index);

        let payout = wager
            .checked_mul(multiplier_bps100 as i128)
            .and_then(|v| v.checked_div(MULTIPLIER_SCALE as i128))
            .ok_or(Error::InvalidInput)?;

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();

        // Wager always moves into the house bankroll first...
        token_client.transfer(&player, &contract_address, &wager);
        let mut bankroll = storage::get_bankroll(&env) + wager;

        // ...then the payout (if any) moves back out. Net bankroll effect
        // is `wager - payout`, which is negative (a house loss) exactly
        // when payout > wager, i.e. multiplier > 1x.
        if payout > 0 {
            token_client.transfer(&contract_address, &player, &payout);
            bankroll -= payout;
        }
        storage::set_bankroll(&env, bankroll);

        let result = DropResult {
            drop_id,
            rows,
            bin_index,
            multiplier_bps100,
            wager,
            payout,
        };

        BallDropped {
            drop_id,
            player,
            rows,
            bin_index,
            multiplier_bps100,
            wager,
            payout,
        }
        .publish(&env);

        Ok(result)
    }

    // -----------------------------------------------------------------------
    // get_bin_multipliers
    // -----------------------------------------------------------------------

    pub fn get_bin_multipliers(env: Env, rows: u32) -> Result<Vec<u32>, Error> {
        if !is_supported_row_count(rows) {
            return Err(Error::UnsupportedRowCount);
        }
        Ok(bin_multiplier_table(&env, rows))
    }

    // -----------------------------------------------------------------------
    // fund_bankroll / sweep_bankroll
    // -----------------------------------------------------------------------

    /// Admin-only: top up the house bankroll.
    pub fn fund_bankroll(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if amount <= 0 {
            return Err(Error::InvalidInput);
        }

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&admin, &contract_address, &amount);

        storage::set_bankroll(&env, storage::get_bankroll(&env) + amount);

        Ok(())
    }

    /// Admin-only: sweep `amount` of house profit out of the bankroll.
    pub fn sweep_bankroll(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if amount <= 0 || amount > storage::get_bankroll(&env) {
            return Err(Error::InvalidInput);
        }

        storage::set_bankroll(&env, storage::get_bankroll(&env) - amount);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &admin, &amount);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_bankroll(env: Env) -> i128 {
        storage::get_bankroll(&env)
    }
}
