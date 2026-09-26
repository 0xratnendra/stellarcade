//! Storage helpers for the referral rewards contract.

use soroban_sdk::{vec, Address, Env, Vec};

use crate::types::{DataKey, Error, RewardTier, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_tiers(env: &Env) -> Vec<RewardTier> {
    env.storage()
        .instance()
        .get(&DataKey::Tiers)
        .unwrap_or_else(|| vec![env])
}

pub fn set_tiers(env: &Env, tiers: &Vec<RewardTier>) {
    env.storage().instance().set(&DataKey::Tiers, tiers);
}

pub fn get_authorized_callers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::AuthorizedCallers)
        .unwrap_or_else(|| vec![env])
}

pub fn set_authorized_callers(env: &Env, callers: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedCallers, callers);
}

pub fn get_referrer(env: &Env, player: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Referrer(player.clone()))
}

pub fn set_referrer(env: &Env, player: &Address, referrer: &Address) {
    let key = DataKey::Referrer(player.clone());
    env.storage().persistent().set(&key, referrer);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_referral_count(env: &Env, referrer: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ReferralCount(referrer.clone()))
        .unwrap_or(0)
}

pub fn set_referral_count(env: &Env, referrer: &Address, count: u32) {
    let key = DataKey::ReferralCount(referrer.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_claimable(env: &Env, referrer: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Claimable(referrer.clone()))
        .unwrap_or(0)
}

pub fn set_claimable(env: &Env, referrer: &Address, amount: i128) {
    let key = DataKey::Claimable(referrer.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
