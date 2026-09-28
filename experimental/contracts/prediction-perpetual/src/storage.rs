use soroban_sdk::{Address, Env};

use crate::types::{Bet, DataKey, Error, Market};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn require_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

/// Allocate and return the next market id, starting at 1.
pub fn next_market_id(env: &Env) -> u64 {
    let count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::MarketCount)
        .unwrap_or(0);
    let next = count + 1;
    env.storage().instance().set(&DataKey::MarketCount, &next);
    next
}

pub fn save_market(env: &Env, market_id: u64, market: &Market) {
    env.storage()
        .persistent()
        .set(&DataKey::Market(market_id), market);
}

pub fn load_market(env: &Env, market_id: u64) -> Result<Market, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Market(market_id))
        .ok_or(Error::MarketNotFound)
}

pub fn save_bet(env: &Env, market_id: u64, player: &Address, bet: &Bet) {
    env.storage()
        .persistent()
        .set(&DataKey::Bet(market_id, player.clone()), bet);
}

pub fn load_bet(env: &Env, market_id: u64, player: &Address) -> Bet {
    env.storage()
        .persistent()
        .get(&DataKey::Bet(market_id, player.clone()))
        .unwrap_or_default()
}
