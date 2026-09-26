//! Storage helpers for the bounty escrow contract.

use soroban_sdk::{Address, Env};

use crate::types::{Bounty, Claim, DataKey, Error, PERSISTENT_BUMP_LEDGERS};

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn next_bounty_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::BountyCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::BountyCount, &next);
    next
}

pub fn get_bounty(env: &Env, id: u64) -> Result<Bounty, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(id))
        .ok_or(Error::NotFound)
}

pub fn set_bounty(env: &Env, bounty: &Bounty) {
    let key = DataKey::Bounty(bounty.id);
    env.storage().persistent().set(&key, bounty);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_claim(env: &Env, bounty_id: u64) -> Option<Claim> {
    env.storage().persistent().get(&DataKey::Claim(bounty_id))
}

pub fn set_claim(env: &Env, bounty_id: u64, claim: &Claim) {
    let key = DataKey::Claim(bounty_id);
    env.storage().persistent().set(&key, claim);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn clear_claim(env: &Env, bounty_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Claim(bounty_id));
}
