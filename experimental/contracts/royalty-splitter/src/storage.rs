//! Storage helpers for the royalty splitter contract.

use soroban_sdk::{vec, Address, Env, Vec};

use crate::types::{DataKey, Error, PendingShareUpdate, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_recipients(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Recipients)
        .unwrap_or_else(|| vec![env])
}

pub fn set_recipients(env: &Env, recipients: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::Recipients, recipients);
}

pub fn get_shares(env: &Env) -> Vec<u32> {
    env.storage()
        .instance()
        .get(&DataKey::Shares)
        .unwrap_or_else(|| vec![env])
}

pub fn set_shares(env: &Env, shares: &Vec<u32>) {
    env.storage().instance().set(&DataKey::Shares, shares);
}

pub fn get_pending_update(env: &Env) -> Option<PendingShareUpdate> {
    env.storage().instance().get(&DataKey::PendingUpdate)
}

pub fn set_pending_update(env: &Env, update: &PendingShareUpdate) {
    env.storage()
        .instance()
        .set(&DataKey::PendingUpdate, update);
}

pub fn clear_pending_update(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingUpdate);
}

pub fn get_claimable(env: &Env, recipient: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Claimable(recipient.clone(), token.clone()))
        .unwrap_or(0)
}

pub fn set_claimable(env: &Env, recipient: &Address, token: &Address, amount: i128) {
    let key = DataKey::Claimable(recipient.clone(), token.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
