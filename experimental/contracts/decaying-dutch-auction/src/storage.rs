//! Storage helpers for the decaying Dutch auction contract.

use soroban_sdk::{Address, Env};

use crate::types::{Auction, DataKey, Error, PERSISTENT_BUMP_LEDGERS};

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn next_auction_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::AuctionCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&DataKey::AuctionCount, &next);
    next
}

pub fn get_auction(env: &Env, id: u64) -> Result<Auction, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Auction(id))
        .ok_or(Error::NotFound)
}

pub fn set_auction(env: &Env, auction: &Auction) {
    let key = DataKey::Auction(auction.id);
    env.storage().persistent().set(&key, auction);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
