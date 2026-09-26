use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, SealedDuel};

pub fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
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

pub fn next_duel_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::NextDuelId).unwrap_or(1);
    env.storage().instance().set(&DataKey::NextDuelId, &(id + 1));
    id
}

pub fn save_duel(env: &Env, duel: &SealedDuel) {
    env.storage().persistent().set(&DataKey::Duel(duel.duel_id), duel);
}

pub fn load_duel(env: &Env, duel_id: u64) -> Result<SealedDuel, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Duel(duel_id))
        .ok_or(Error::DuelNotFound)
}
