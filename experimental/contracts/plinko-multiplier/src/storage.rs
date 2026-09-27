//! Storage helpers for the plinko multiplier contract.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn require_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_bankroll(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::Bankroll)
        .unwrap_or(0)
}

pub fn set_bankroll(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::Bankroll, &amount);
}

pub fn next_drop_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::DropCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::DropCount, &next);
    next
}
