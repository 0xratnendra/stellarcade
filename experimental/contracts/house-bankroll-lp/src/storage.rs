use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PendingWithdraw};

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

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn get_total_shares(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalShares)
        .unwrap_or(0)
}

pub fn set_total_shares(env: &Env, shares: i128) {
    env.storage().instance().set(&DataKey::TotalShares, &shares);
}

pub fn get_total_equity(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalEquity)
        .unwrap_or(0)
}

pub fn set_total_equity(env: &Env, equity: i128) {
    env.storage().instance().set(&DataKey::TotalEquity, &equity);
}

pub fn get_admin_fees(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::AdminFees)
        .unwrap_or(0)
}

pub fn set_admin_fees(env: &Env, fees: i128) {
    env.storage().instance().set(&DataKey::AdminFees, &fees);
}

pub fn is_game_authorized(env: &Env, game: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::GameAuthorized(game.clone()))
        .unwrap_or(false)
}

pub fn set_game_authorized(env: &Env, game: &Address, authorized: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::GameAuthorized(game.clone()), &authorized);
}

pub fn get_shares(env: &Env, provider: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Shares(provider.clone()))
        .unwrap_or(0)
}

pub fn set_shares(env: &Env, provider: &Address, shares: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Shares(provider.clone()), &shares);
}

pub fn get_pending_withdraw(env: &Env, provider: &Address) -> Option<PendingWithdraw> {
    env.storage()
        .persistent()
        .get(&DataKey::PendingWithdraw(provider.clone()))
}

pub fn set_pending_withdraw(env: &Env, provider: &Address, pending: &PendingWithdraw) {
    env.storage()
        .persistent()
        .set(&DataKey::PendingWithdraw(provider.clone()), pending);
}

pub fn clear_pending_withdraw(env: &Env, provider: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::PendingWithdraw(provider.clone()));
}
