//! Storage helpers for the progressive jackpot vault contract.

use soroban_sdk::{Address, Env};

use crate::types::{Config, DataKey, Error};

pub fn has_config(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn get_config(env: &Env) -> Result<Config, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(Error::NotInitialized)
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_pot(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::Pot).unwrap_or(0)
}

pub fn set_pot(env: &Env, pot: i128) {
    env.storage().instance().set(&DataKey::Pot, &pot);
}

pub fn is_whitelisted(env: &Env, game_address: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::Whitelist(game_address.clone()))
}

pub fn whitelist(env: &Env, game_address: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::Whitelist(game_address.clone()), &true);
}
