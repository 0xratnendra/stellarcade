//! Decaying Dutch Auction
//!
//! An experimental Soroban contract for auctioning limited-edition arcade
//! cosmetic items where the price decays linearly from a starting price
//! down to a reserve floor over a fixed duration. Any buyer can purchase
//! at the exact current decaying price by calling `buy` with a
//! `max_price` slippage guard; if no one buys, the seller can cancel.
//!
//! ## Storage Strategy
//! - `instance()`: Token, auction counter. Small, shared config.
//! - `persistent()`: `Auction(id)`, bumped on every write.
//!
//! ## Invariants
//! - `get_current_price` never returns less than the auction's
//!   `reserve_price`, regardless of how much time has elapsed.
//! - `buy` only succeeds while the auction is open (`closed == false`);
//!   the first successful `buy` or `cancel_auction` call closes it.
//! - `buy` rejects if the current decaying price exceeds the caller's
//!   supplied `max_price` slippage guard.
//! - Only the auction's `seller` may cancel it.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};

pub use types::{Auction, Error};
use types::{AuctionBought, AuctionCancelled, AuctionCreated};

#[contract]
pub struct DecayingDutchAuction;

#[contractimpl]
impl DecayingDutchAuction {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, token: Address) {
        storage::set_token(&env, &token);
    }

    // -----------------------------------------------------------------------
    // create_auction
    // -----------------------------------------------------------------------

    /// Create a new auction for `item_id`, starting at `start_price` and
    /// decaying linearly to `reserve_price` over `duration` seconds
    /// starting now. Returns the new auction's id.
    pub fn create_auction(
        env: Env,
        seller: Address,
        item_id: Symbol,
        start_price: i128,
        reserve_price: i128,
        duration: u64,
    ) -> Result<u64, Error> {
        seller.require_auth();

        if start_price <= 0 || reserve_price < 0 || reserve_price > start_price || duration == 0 {
            return Err(Error::InvalidInput);
        }

        let id = storage::next_auction_id(&env);
        let auction = Auction {
            id,
            seller: seller.clone(),
            item_id: item_id.clone(),
            start_price,
            reserve_price,
            start_time: env.ledger().timestamp(),
            duration,
            closed: false,
        };
        storage::set_auction(&env, &auction);

        AuctionCreated {
            auction_id: id,
            seller,
            item_id,
            start_price,
            reserve_price,
            duration,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // get_current_price
    // -----------------------------------------------------------------------

    /// The current decaying price for `auction_id`: linear interpolation
    /// between `start_price` (at `start_time`) and `reserve_price` (at
    /// `start_time + duration`), floored at `reserve_price` once the
    /// duration has fully elapsed.
    pub fn get_current_price(env: Env, auction_id: u64) -> Result<i128, Error> {
        let auction = storage::get_auction(&env, auction_id)?;
        Ok(current_price(&env, &auction))
    }

    // -----------------------------------------------------------------------
    // buy
    // -----------------------------------------------------------------------

    /// Buy the item at the exact current decaying price, so long as it
    /// does not exceed `max_price`. Transfers `price` from `buyer` to the
    /// auction's `seller` and closes the auction.
    pub fn buy(env: Env, buyer: Address, auction_id: u64, max_price: i128) -> Result<i128, Error> {
        buyer.require_auth();

        let mut auction = storage::get_auction(&env, auction_id)?;
        if auction.closed {
            return Err(Error::AuctionClosed);
        }

        let price = current_price(&env, &auction);
        if price > max_price {
            return Err(Error::PriceExceedsMax);
        }

        auction.closed = true;
        storage::set_auction(&env, &auction);

        let token_client = token::Client::new(&env, &storage::get_token(&env));
        token_client.transfer(&buyer, &auction.seller, &price);

        AuctionBought {
            auction_id,
            buyer,
            price_paid: price,
        }
        .publish(&env);

        Ok(price)
    }

    // -----------------------------------------------------------------------
    // cancel_auction
    // -----------------------------------------------------------------------

    /// Seller-only: cancel an open auction before it is bought.
    pub fn cancel_auction(env: Env, seller: Address, auction_id: u64) -> Result<(), Error> {
        seller.require_auth();

        let mut auction = storage::get_auction(&env, auction_id)?;
        if seller != auction.seller {
            return Err(Error::NotSeller);
        }
        if auction.closed {
            return Err(Error::AuctionClosed);
        }

        auction.closed = true;
        storage::set_auction(&env, &auction);

        AuctionCancelled { auction_id, seller }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_auction(env: Env, auction_id: u64) -> Result<Auction, Error> {
        storage::get_auction(&env, auction_id)
    }
}

/// Linear decay from `start_price` to `reserve_price` over `duration`
/// seconds, floored at `reserve_price`.
fn current_price(env: &Env, auction: &Auction) -> i128 {
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(auction.start_time);
    if elapsed >= auction.duration {
        return auction.reserve_price;
    }

    let price_range = auction.start_price - auction.reserve_price;
    let decayed = (price_range * elapsed as i128) / auction.duration as i128;
    auction.start_price - decayed
}
