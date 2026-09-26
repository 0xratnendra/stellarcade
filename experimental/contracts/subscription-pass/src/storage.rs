//! Storage helpers for the subscription pass contract.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PassRecord, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_pass_cost(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::PassCost).unwrap()
}

pub fn set_pass_cost(env: &Env, cost: i128) {
    env.storage().instance().set(&DataKey::PassCost, &cost);
}

pub fn get_duration_ledgers(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::DurationLedgers)
        .unwrap()
}

pub fn set_duration_ledgers(env: &Env, duration: u32) {
    env.storage()
        .instance()
        .set(&DataKey::DurationLedgers, &duration);
}

pub fn get_tier_bonus(env: &Env, tier: u32) -> u32 {
    if tier == 0 {
        return 0;
    }
    env.storage()
        .instance()
        .get(&DataKey::TierBonus(tier))
        .unwrap_or(0)
}

pub fn set_tier_bonus(env: &Env, tier: u32, bonus_ledgers: u32) {
    env.storage()
        .instance()
        .set(&DataKey::TierBonus(tier), &bonus_ledgers);
}

pub fn get_pass(env: &Env, player: &Address) -> Option<PassRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Pass(player.clone()))
}

pub fn set_pass(env: &Env, pass: &PassRecord) {
    let key = DataKey::Pass(pass.player.clone());
    env.storage().persistent().set(&key, pass);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
