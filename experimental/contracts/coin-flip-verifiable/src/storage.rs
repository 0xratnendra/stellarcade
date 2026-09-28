//! Storage helpers for the coin flip verifiable escrow contract.

use soroban_sdk::Env;

use crate::types::{Config, DataKey, Error, Game, PERSISTENT_BUMP_LEDGERS};

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

pub fn next_game_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::GameCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::GameCount, &next);
    next
}

pub fn get_game(env: &Env, id: u64) -> Result<Game, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Game(id))
        .ok_or(Error::NotFound)
}

pub fn set_game(env: &Env, game: &Game) {
    let key = DataKey::Game(game.id);
    env.storage().persistent().set(&key, game);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
