//! Storage helpers for the milestone escrow contract.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_oracle(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Oracle).unwrap()
}

pub fn set_oracle(env: &Env, oracle: &Address) {
    env.storage().instance().set(&DataKey::Oracle, oracle);
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_pool(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Pool).unwrap_or(0)
}

pub fn set_pool(env: &Env, pool: i128) {
    env.storage().instance().set(&DataKey::Pool, &pool);
}

pub fn get_milestone_reward(env: &Env, milestone_id: u64) -> Option<i128> {
    env.storage()
        .instance()
        .get(&DataKey::MilestoneReward(milestone_id))
}

pub fn set_milestone_reward(env: &Env, milestone_id: u64, reward: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MilestoneReward(milestone_id), &reward);
}

pub fn is_verified(env: &Env, player: &Address, milestone_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Verified(player.clone(), milestone_id))
}

pub fn set_verified(env: &Env, player: &Address, milestone_id: u64) {
    let key = DataKey::Verified(player.clone(), milestone_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn is_claimed(env: &Env, player: &Address, milestone_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Claimed(player.clone(), milestone_id))
}

pub fn set_claimed(env: &Env, player: &Address, milestone_id: u64) {
    let key = DataKey::Claimed(player.clone(), milestone_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
