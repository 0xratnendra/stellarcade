//! Storage helpers for the time-locked wager contract.

use soroban_sdk::Env;

use crate::types::{Challenge, DataKey, Error, PERSISTENT_BUMP_LEDGERS};

pub fn next_challenge_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ChallengeCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&DataKey::ChallengeCount, &next);
    next
}

pub fn get_challenge(env: &Env, id: u64) -> Result<Challenge, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Challenge(id))
        .ok_or(Error::NotFound)
}

pub fn set_challenge(env: &Env, challenge: &Challenge) {
    let key = DataKey::Challenge(challenge.id);
    env.storage().persistent().set(&key, challenge);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
