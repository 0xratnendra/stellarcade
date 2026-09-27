//! Storage helpers for the dice duel escrow contract.

use soroban_sdk::Env;

use crate::types::{DataKey, Duel, Error, PERSISTENT_BUMP_LEDGERS};

pub fn next_duel_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::DuelCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::DuelCount, &next);
    next
}

pub fn get_duel(env: &Env, id: u64) -> Result<Duel, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Duel(id))
        .ok_or(Error::NotFound)
}

pub fn set_duel(env: &Env, duel: &Duel) {
    let key = DataKey::Duel(duel.id);
    env.storage().persistent().set(&key, duel);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
