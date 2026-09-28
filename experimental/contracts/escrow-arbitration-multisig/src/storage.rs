//! Storage helpers for the escrow arbitration multisig contract.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Dispute, Error, Ruling, PERSISTENT_BUMP_LEDGERS};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Token)
}

pub fn require_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_next_dispute_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextDisputeId)
        .unwrap_or(1)
}

pub fn set_next_dispute_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextDisputeId, &id);
}

pub fn get_dispute(env: &Env, dispute_id: u64) -> Result<Dispute, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Dispute(dispute_id))
        .ok_or(Error::DisputeNotFound)
}

pub fn set_dispute(env: &Env, dispute: &Dispute) {
    let key = DataKey::Dispute(dispute.dispute_id);
    env.storage().persistent().set(&key, dispute);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_vote(env: &Env, dispute_id: u64, arbiter: &Address) -> Option<Ruling> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(dispute_id, arbiter.clone()))
}

pub fn set_vote(env: &Env, dispute_id: u64, arbiter: &Address, ruling: &Ruling) {
    let key = DataKey::Vote(dispute_id, arbiter.clone());
    env.storage().persistent().set(&key, ruling);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
