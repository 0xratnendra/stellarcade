//! Lottery Pot
//!
//! An epoch-based pooled lottery. Players buy tickets at a fixed price
//! during a ledger-bounded epoch; once the epoch's deadline passes, the
//! admin draws a winner using a commit-reveal random seed; the winner
//! claims 90% of the pot, and the remaining 10% rolls over into the next
//! epoch. If a draw never happens, players can claim an emergency refund
//! of their ticket cost after a grace period.
//!
//! ## Provable fairness (commit-reveal)
//!
//! Every ticket purchase happens on-chain, before any random seed is
//! known — this is the "commit" half of commit-reveal: the full set of
//! ticket ranges (and therefore every possible winning outcome) is fixed
//! and publicly visible before the draw. `draw_winner`'s "reveal" half
//! combines the caller-supplied `random_seed` with the epoch id via
//! `sha256(random_seed || epoch_id_be)`, matching this workspace's
//! `wheel-of-fortune` contract's commit-reveal derivation (see
//! `experimental/contracts/wheel-of-fortune/src/lib.rs`'s
//! `derive_segment_index`). Because ticket sales are already closed and
//! immutable by the time `random_seed` is revealed, nobody (including the
//! revealer) can retroactively change which tickets exist to influence the
//! outcome — the only remaining trust assumption is that whoever reveals
//! `random_seed` did not have foreknowledge of it before sales closed,
//! which is the same assumption `wheel-of-fortune`'s server-secret reveal
//! makes.
//!
//! ## Storage Strategy
//! - `instance()`: Admin, token, and the current epoch id.
//! - `persistent()`: `Epoch(id)`, `PlayerTickets(epoch_id, player)`,
//!   `TicketRanges(epoch_id)`, and `Refunded(epoch_id, player)` — each
//!   bumped on every write.
//!
//! ## Invariants
//! - The contract can only be initialized once.
//! - Ticket purchases are locked once `draw_deadline_ledger` has passed.
//! - A given epoch can be drawn at most once.
//! - The jackpot for a drawn epoch can be claimed at most once, and only by
//!   the address holding the drawn winning ticket.
//! - An epoch with zero tickets sold simply rolls its pot into the next
//!   epoch on `draw_winner` rather than attempting to pick a winner.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env};

pub use types::Error;
use types::{
    EmergencyRefunded, Epoch, EpochRolledOverEmpty, JackpotClaimed, LotteryStarted, TicketRange,
    TicketsPurchased, WinnerDrawn, EMERGENCY_REFUND_GRACE_LEDGERS, ROLLOVER_SHARE_BPS,
    WINNER_SHARE_BPS,
};

#[contract]
pub struct LotteryPot;

#[contractimpl]
impl LotteryPot {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once. Does not itself
    /// start an epoch — call `start_lottery` after.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_epoch_id(&env, 0);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // start_lottery
    // -----------------------------------------------------------------------

    /// Admin-only: start a new epoch with `ticket_price` per ticket and
    /// ticket sales open for `duration` ledgers. Any pot rolled over from
    /// the previous epoch (via an empty draw) carries into the new epoch's
    /// starting pot.
    pub fn start_lottery(
        env: Env,
        admin: Address,
        ticket_price: i128,
        duration: u32,
    ) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }
        if ticket_price <= 0 || duration == 0 {
            return Err(Error::InvalidInput);
        }

        // Whatever remains in the previous epoch's `pot` field always
        // rolls forward: in the zero-ticket case `draw_winner` leaves the
        // full pot untouched, and in the normal case `claim_jackpot`
        // already reduces `pot` down to just the 10% rollover share before
        // this reads it. A never-started previous epoch (id 0) has
        // nothing to roll over.
        //
        // Guard: if the previous epoch sold tickets, was drawn, and its
        // jackpot has NOT yet been claimed, refuse to start a new epoch.
        // Otherwise its still-unclaimed 90% winner share (sitting in
        // `pot` alongside the rollover share) would get folded into the
        // new epoch's starting pot, and the original winner would have no
        // way to claim it (claim_jackpot only ever looks at the CURRENT
        // epoch).
        let previous_id = storage::get_epoch_id(&env);
        let previous_epoch = if previous_id > 0 {
            Some(storage::get_epoch(&env, previous_id)?)
        } else {
            None
        };
        if let Some(e) = &previous_epoch {
            if e.drawn && e.tickets_sold > 0 && !e.jackpot_claimed {
                return Err(Error::PreviousJackpotUnclaimed);
            }
        }
        let rollover = previous_epoch.map(|e| e.pot).unwrap_or(0);

        let id = previous_id + 1;
        storage::set_epoch_id(&env, id);

        let draw_deadline_ledger = env.ledger().sequence() + duration;
        let epoch = Epoch {
            id,
            ticket_price,
            draw_deadline_ledger,
            tickets_sold: 0,
            pot: rollover,
            drawn: false,
            winning_ticket_id: None,
            jackpot_claimed: false,
        };
        storage::set_epoch(&env, &epoch);

        LotteryStarted {
            epoch_id: id,
            ticket_price,
            draw_deadline_ledger,
            starting_pot: rollover,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // buy_tickets
    // -----------------------------------------------------------------------

    /// Purchase `ticket_count` tickets in the current epoch, assigning them
    /// a contiguous, sequential range of ticket ids starting at the
    /// current `tickets_sold`. Locked once the epoch's draw deadline has
    /// passed.
    pub fn buy_tickets(env: Env, player: Address, ticket_count: u64) -> Result<u64, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        if ticket_count == 0 {
            return Err(Error::InvalidInput);
        }

        let epoch_id = storage::get_epoch_id(&env);
        let mut epoch = storage::get_epoch(&env, epoch_id)?;

        if env.ledger().sequence() >= epoch.draw_deadline_ledger {
            return Err(Error::TicketSalesClosed);
        }

        let cost = epoch
            .ticket_price
            .checked_mul(ticket_count as i128)
            .ok_or(Error::InvalidInput)?;

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &cost);

        let start_id = epoch.tickets_sold;
        epoch.tickets_sold += ticket_count;
        epoch.pot = epoch.pot.checked_add(cost).ok_or(Error::InvalidInput)?;
        storage::set_epoch(&env, &epoch);

        storage::append_ticket_range(
            &env,
            epoch_id,
            &TicketRange {
                player: player.clone(),
                start_id,
                count: ticket_count,
            },
        );
        let total_for_player = storage::get_player_tickets(&env, epoch_id, &player) + ticket_count;
        storage::set_player_tickets(&env, epoch_id, &player, total_for_player);

        TicketsPurchased {
            epoch_id,
            player,
            start_id,
            count: ticket_count,
        }
        .publish(&env);

        Ok(start_id)
    }

    // -----------------------------------------------------------------------
    // draw_winner
    // -----------------------------------------------------------------------

    /// Admin-only: draw the current epoch's winner. Requires the draw
    /// deadline to have passed and the epoch not to have been drawn yet.
    ///
    /// If zero tickets were sold, there is no ticket to pick a winner from:
    /// the pot simply rolls over (this epoch is marked `drawn` with no
    /// `winning_ticket_id`, and its `pot` remains for `start_lottery` to
    /// carry into the next epoch). Otherwise, derives a winning ticket id
    /// via `sha256(random_seed || epoch_id_be) % tickets_sold` and records
    /// it — see the module doc's "Provable fairness" section. Returns the
    /// winning ticket's owner (`Ok(None)` for the zero-ticket rollover
    /// case, rather than an `Address` placeholder).
    pub fn draw_winner(
        env: Env,
        admin: Address,
        random_seed: BytesN<32>,
    ) -> Result<Option<Address>, Error> {
        storage::require_initialized(&env)?;
        admin.require_auth();

        if admin != storage::get_admin(&env) {
            return Err(Error::InvalidInput);
        }

        let epoch_id = storage::get_epoch_id(&env);
        let mut epoch = storage::get_epoch(&env, epoch_id)?;

        if env.ledger().sequence() < epoch.draw_deadline_ledger {
            return Err(Error::DrawNotYetAllowed);
        }
        if epoch.drawn {
            return Err(Error::AlreadyDrawn);
        }

        if epoch.tickets_sold == 0 {
            epoch.drawn = true;
            storage::set_epoch(&env, &epoch);
            EpochRolledOverEmpty {
                epoch_id,
                rolled_over_pot: epoch.pot,
            }
            .publish(&env);
            return Ok(None);
        }

        let winning_ticket_id =
            derive_winning_ticket_id(&env, &random_seed, epoch_id, epoch.tickets_sold);
        epoch.drawn = true;
        epoch.winning_ticket_id = Some(winning_ticket_id);
        storage::set_epoch(&env, &epoch);

        WinnerDrawn {
            epoch_id,
            winning_ticket_id,
        }
        .publish(&env);

        let winner = resolve_ticket_owner(&env, epoch_id, winning_ticket_id);
        Ok(winner)
    }

    // -----------------------------------------------------------------------
    // claim_jackpot
    // -----------------------------------------------------------------------

    /// Claim the drawn jackpot for the current epoch. `winner` must be the
    /// address that actually holds the drawn winning ticket; pays 90% of
    /// the pot to `winner` and rolls the remaining 10% into the next
    /// epoch's starting pot (left in this epoch's own `pot` field for
    /// `start_lottery` to read).
    pub fn claim_jackpot(env: Env, winner: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        winner.require_auth();

        let epoch_id = storage::get_epoch_id(&env);
        let mut epoch = storage::get_epoch(&env, epoch_id)?;

        if !epoch.drawn {
            return Err(Error::NotYetDrawn);
        }
        if epoch.jackpot_claimed {
            return Err(Error::AlreadyClaimed);
        }
        let winning_ticket_id = epoch.winning_ticket_id.ok_or(Error::NoTicketsSold)?;

        let actual_winner =
            resolve_ticket_owner(&env, epoch_id, winning_ticket_id).ok_or(Error::NoTicketsSold)?;
        if winner != actual_winner {
            return Err(Error::NotTheWinner);
        }

        let winner_amount = epoch
            .pot
            .checked_mul(WINNER_SHARE_BPS)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(Error::InvalidInput)?;
        let rollover_amount = epoch
            .pot
            .checked_mul(ROLLOVER_SHARE_BPS)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(Error::InvalidInput)?;

        epoch.jackpot_claimed = true;
        epoch.pot = rollover_amount;
        storage::set_epoch(&env, &epoch);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &winner, &winner_amount);

        JackpotClaimed {
            epoch_id,
            winner,
            winner_amount,
            rollover_amount,
        }
        .publish(&env);

        Ok(winner_amount)
    }

    // -----------------------------------------------------------------------
    // emergency_refund
    // -----------------------------------------------------------------------

    /// Claim a refund of `player`'s ticket cost for the current epoch, if
    /// the draw deadline plus a grace period has passed with no draw ever
    /// having happened. Exists so a stuck epoch (e.g. the admin key is
    /// lost or simply never calls `draw_winner`) does not permanently trap
    /// player funds.
    pub fn emergency_refund(env: Env, player: Address) -> Result<i128, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let epoch_id = storage::get_epoch_id(&env);
        let epoch = storage::get_epoch(&env, epoch_id)?;

        if epoch.drawn {
            return Err(Error::RefundNotAvailable);
        }
        let refund_available_at = epoch
            .draw_deadline_ledger
            .checked_add(EMERGENCY_REFUND_GRACE_LEDGERS)
            .ok_or(Error::InvalidInput)?;
        if env.ledger().sequence() < refund_available_at {
            return Err(Error::RefundNotAvailable);
        }
        if storage::is_refunded(&env, epoch_id, &player) {
            return Err(Error::AlreadyRefunded);
        }

        let ticket_count = storage::get_player_tickets(&env, epoch_id, &player);
        if ticket_count == 0 {
            return Err(Error::NothingToRefund);
        }

        let refund_amount = epoch
            .ticket_price
            .checked_mul(ticket_count as i128)
            .ok_or(Error::InvalidInput)?;

        storage::set_refunded(&env, epoch_id, &player);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &player, &refund_amount);

        EmergencyRefunded {
            epoch_id,
            player,
            amount: refund_amount,
        }
        .publish(&env);

        Ok(refund_amount)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    /// Return the current epoch's state.
    pub fn get_current_epoch(env: Env) -> Result<Epoch, Error> {
        let epoch_id = storage::get_epoch_id(&env);
        storage::get_epoch(&env, epoch_id)
    }

    /// Return `player`'s ticket count in the current epoch.
    pub fn get_player_ticket_count(env: Env, player: Address) -> u64 {
        let epoch_id = storage::get_epoch_id(&env);
        storage::get_player_tickets(&env, epoch_id, &player)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Derive the winning ticket id from `sha256(random_seed || epoch_id_be) %
/// tickets_sold`. `tickets_sold` must be > 0.
fn derive_winning_ticket_id(
    env: &Env,
    random_seed: &BytesN<32>,
    epoch_id: u64,
    tickets_sold: u64,
) -> u64 {
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&random_seed.to_array());
    preimage[32..].copy_from_slice(&epoch_id.to_be_bytes());

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
/// epoch's ticket ranges. Returns `None` if the id falls in no range
/// (should not happen for a valid, in-bounds `winning_ticket_id`).
fn resolve_ticket_owner(env: &Env, epoch_id: u64, ticket_id: u64) -> Option<Address> {
    let ranges = storage::get_ticket_ranges(env, epoch_id);
    for range in ranges.iter() {
        if ticket_id >= range.start_id && ticket_id < range.start_id + range.count {
            return Some(range.player.clone());
        }
    }
    None
}
