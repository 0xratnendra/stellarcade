use soroban_sdk::{Address, Env, String};

use crate::types::{BadgeInfo, DataKey, Error};

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

pub fn set_name(env: &Env, name: &String) {
    env.storage().instance().set(&DataKey::Name, name);
}

pub fn set_symbol(env: &Env, symbol: &String) {
    env.storage().instance().set(&DataKey::Symbol, symbol);
}

pub fn has_badge(env: &Env, owner: &Address, badge_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Badge(owner.clone(), badge_id))
}

pub fn set_badge(env: &Env, owner: &Address, badge_id: u64, badge: &BadgeInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::Badge(owner.clone(), badge_id), badge);
}

pub fn load_badge(env: &Env, owner: &Address, badge_id: u64) -> Result<BadgeInfo, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Badge(owner.clone(), badge_id))
        .ok_or(Error::BadgeNotFound)
}

pub fn remove_badge(env: &Env, owner: &Address, badge_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Badge(owner.clone(), badge_id));
}
