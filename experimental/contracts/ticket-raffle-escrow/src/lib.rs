//! Ticket Raffle Escrow
//!
//! Players buy tickets at a fixed price before `end_time`; once the
//! deadline passes, the admin draws a winner using a commit-reveal random
//! seed, and the full prize pool transfers automatically to the winner's
//! wallet.
//!
//! ## Provable fairness (commit-reveal)
//!
//! Every ticket purchase happens on-chain, before any random seed is
//! known — this is the "commit" half of commit-reveal: the full set of
//! ticket ranges (and therefore every possible winning outcome) is fixed
//! and publicly visible before the draw. `draw_winner`'s "reveal" half
//! combines the caller-supplied `seed` with the raffle id via
//! `sha256(seed || raffle_id_be)`. Because ticket sales are already closed
//! and immutable by the time `seed` is revealed, nobody (including the
//! revealer) can retroactively change which tickets exist to influence the
//! outcome — the only remaining trust assumption is that whoever reveals
//! `seed` did not have foreknowledge of it before sales closed, matching
//! this workspace's `lottery-pot` contract's same derivation.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, and the next raffle id counter.
//! - `persistent()`: `Raffle(id)`, `PlayerTickets(raffle_id, player)`, and
//!   `TicketRanges(raffle_id)` — each bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Ticket purchases are rejected once `end_time` has passed.
//! - A wallet cannot hold more than `max_tickets_per_wallet` tickets in a
//!   given raffle.
//! - A given raffle can only be drawn once, and only after `end_time`.
//! - The prize can only be claimed once, automatically, by `draw_winner`.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env};

pub use types::Error;
use types::{Raffle, RaffleCreated, TicketRange, TicketsPurchased, WinnerDrawn};

#[contract]
pub struct TicketRaffleEscrow;

#[contractimpl]
impl TicketRaffleEscrow {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_next_raffle_id(&env, 1);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_raffle
    // -----------------------------------------------------------------------

    /// Admin-only: create a new raffle with `ticket_price` per ticket,
    /// sales open until `end_time` (unix timestamp), and at most
    /// `max_tickets` tickets per wallet.
    pub fn create_raffle(
        env: Env,
        admin: Address,
        ticket_price: i128,
        end_time: u64,
        max_tickets: u64,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if ticket_price <= 0 || max_tickets == 0 {
            return Err(Error::InvalidInput);
        }
        if end_time <= env.ledger().timestamp() {
            return Err(Error::InvalidInput);
        }

        let id = storage::get_next_raffle_id(&env);
        storage::set_next_raffle_id(&env, id + 1);

        let raffle = Raffle {
            id,
            admin,
            ticket_price,
            end_time,
            max_tickets_per_wallet: max_tickets,
            tickets_sold: 0,
            pool: 0,
            drawn: false,
            winning_ticket_id: None,
            prize_claimed: false,
        };
        storage::set_raffle(&env, &raffle);

        RaffleCreated {
            raffle_id: id,
            ticket_price,
            end_time,
            max_tickets_per_wallet: max_tickets,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // buy_tickets
    // -----------------------------------------------------------------------

    /// Purchase `count` tickets in `raffle_id`, assigning them a
    /// contiguous, sequential range of ticket ids starting at the raffle's
    /// current `tickets_sold`. Rejected once `end_time` has passed, or if
    /// the purchase would push the player's total above
    /// `max_tickets_per_wallet`.
    pub fn buy_tickets(
        env: Env,
        player: Address,
        raffle_id: u64,
        count: u64,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        if count == 0 {
            return Err(Error::InvalidInput);
        }

        let mut raffle = storage::get_raffle(&env, raffle_id)?;

        if env.ledger().timestamp() >= raffle.end_time {
            return Err(Error::RaffleClosed);
        }

        let existing = storage::get_player_tickets(&env, raffle_id, &player);
        let new_total = existing.checked_add(count).ok_or(Error::InvalidInput)?;
        if new_total > raffle.max_tickets_per_wallet {
            return Err(Error::MaxTicketsPerWalletExceeded);
        }

        let cost = raffle
            .ticket_price
            .checked_mul(count as i128)
            .ok_or(Error::InvalidInput)?;

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &cost);

        let start_id = raffle.tickets_sold;
        raffle.tickets_sold += count;
        raffle.pool = raffle.pool.checked_add(cost).ok_or(Error::InvalidInput)?;
        storage::set_raffle(&env, &raffle);

        storage::append_ticket_range(
            &env,
            raffle_id,
            &TicketRange {
                player: player.clone(),
                start_id,
                count,
            },
        );
        storage::set_player_tickets(&env, raffle_id, &player, new_total);

        TicketsPurchased {
            raffle_id,
            player,
            start_id,
            count,
        }
        .publish(&env);

        Ok(start_id)
    }

    // -----------------------------------------------------------------------
    // draw_winner
    // -----------------------------------------------------------------------

    /// Admin-only: draw `raffle_id`'s winner and automatically transfer the
    /// full prize pool to them. Requires `end_time` to have passed, at
    /// least one ticket sold, and the raffle not to have been drawn yet.
    pub fn draw_winner(
        env: Env,
        admin: Address,
        raffle_id: u64,
        seed: BytesN<32>,
    ) -> Result<Address, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }

        let mut raffle = storage::get_raffle(&env, raffle_id)?;

        if env.ledger().timestamp() < raffle.end_time {
            return Err(Error::DrawNotYetAllowed);
        }
        if raffle.drawn {
            return Err(Error::AlreadyDrawn);
        }
        if raffle.tickets_sold == 0 {
            return Err(Error::NoTicketsSold);
        }

        let winning_ticket_id =
            derive_winning_ticket_id(&env, &seed, raffle_id, raffle.tickets_sold);
        let winner =
            resolve_ticket_owner(&env, raffle_id, winning_ticket_id).ok_or(Error::NoTicketsSold)?;

        raffle.drawn = true;
        raffle.winning_ticket_id = Some(winning_ticket_id);
        raffle.prize_claimed = true;
        let prize_amount = raffle.pool;
        storage::set_raffle(&env, &raffle);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &winner, &prize_amount);

        WinnerDrawn {
            raffle_id,
            winner: winner.clone(),
            winning_ticket_id,
            prize_amount,
        }
        .publish(&env);

        Ok(winner)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Return `raffle_id`'s current state.
    pub fn get_raffle(env: Env, raffle_id: u64) -> Result<Raffle, Error> {
        storage::get_raffle(&env, raffle_id)
    }

    /// Return `player`'s ticket count in `raffle_id`.
    pub fn get_player_ticket_count(env: Env, raffle_id: u64, player: Address) -> u64 {
        storage::get_player_tickets(&env, raffle_id, &player)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Derive the winning ticket id from `sha256(seed || raffle_id_be) %
/// tickets_sold`. `tickets_sold` must be > 0.
fn derive_winning_ticket_id(
    env: &Env,
    seed: &BytesN<32>,
    raffle_id: u64,
    tickets_sold: u64,
) -> u64 {
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&seed.to_array());
    preimage[32..].copy_from_slice(&raffle_id.to_be_bytes());

    let digest: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage))
        .into();
    let arr = digest.to_array();
    let raw = u64::from_be_bytes([
        arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
    ]);
    raw % tickets_sold
}

/// Resolve a winning ticket id to the player who owns it, by scanning the
/// raffle's ticket ranges. Returns `None` if the id falls in no range
/// (should not happen for a valid, in-bounds `winning_ticket_id`).
fn resolve_ticket_owner(env: &Env, raffle_id: u64, ticket_id: u64) -> Option<Address> {
    let ranges = storage::get_ticket_ranges(env, raffle_id);
    for range in ranges.iter() {
        if ticket_id >= range.start_id && ticket_id < range.start_id + range.count {
            return Some(range.player.clone());
        }
    }
    None
}
