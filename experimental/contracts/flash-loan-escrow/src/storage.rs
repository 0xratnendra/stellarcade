//! Storage helpers for the flash loan escrow contract.

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

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::FeeBps).unwrap()
}

pub fn set_fee_bps(env: &Env, fee_bps: u32) {
    env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
}

pub fn get_total_principal(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalPrincipal)
        .unwrap_or(0)
}

pub fn set_total_principal(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalPrincipal, &amount);
}

pub fn get_fee_accumulator(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::FeeAccumulator)
        .unwrap_or(0)
}

pub fn set_fee_accumulator(env: &Env, value: i128) {
    env.storage()
        .instance()
        .set(&DataKey::FeeAccumulator, &value);
}

pub fn get_provider_principal(env: &Env, provider: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ProviderPrincipal(provider.clone()))
        .unwrap_or(0)
}

pub fn set_provider_principal(env: &Env, provider: &Address, amount: i128) {
    let key = DataKey::ProviderPrincipal(provider.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_provider_fee_acc_checkpoint(env: &Env, provider: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ProviderFeeAccChkpt(provider.clone()))
        .unwrap_or(0)
}

pub fn set_provider_fee_acc_checkpoint(env: &Env, provider: &Address, value: i128) {
    let key = DataKey::ProviderFeeAccChkpt(provider.clone());
    env.storage().persistent().set(&key, &value);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_provider_fees_earned(env: &Env, provider: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ProviderFeesEarned(provider.clone()))
        .unwrap_or(0)
}

pub fn set_provider_fees_earned(env: &Env, provider: &Address, amount: i128) {
    let key = DataKey::ProviderFeesEarned(provider.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
