//! Storage helpers for the staked governance contract.

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PendingUnstake, Proposal, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_quorum_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::QuorumBps).unwrap()
}

pub fn set_quorum_bps(env: &Env, quorum_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::QuorumBps, &quorum_bps);
}

pub fn get_total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalStaked)
        .unwrap_or(0)
}

pub fn set_total_staked(env: &Env, total: i128) {
    env.storage().instance().set(&DataKey::TotalStaked, &total);
}

pub fn next_proposal_id(env: &Env) -> u64 {
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::ProposalCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::ProposalCount, &next);
    next
}

pub fn get_staked(env: &Env, voter: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Staked(voter.clone()))
        .unwrap_or(0)
}

pub fn set_staked(env: &Env, voter: &Address, amount: i128) {
    let key = DataKey::Staked(voter.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_pending_unstake(env: &Env, voter: &Address) -> Option<PendingUnstake> {
    env.storage()
        .persistent()
        .get(&DataKey::PendingUnstake(voter.clone()))
}

pub fn set_pending_unstake(env: &Env, voter: &Address, pending: &PendingUnstake) {
    let key = DataKey::PendingUnstake(voter.clone());
    env.storage().persistent().set(&key, pending);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn clear_pending_unstake(env: &Env, voter: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::PendingUnstake(voter.clone()));
}

pub fn get_locked_until(env: &Env, voter: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::LockedUntil(voter.clone()))
        .unwrap_or(0)
}

pub fn set_locked_until(env: &Env, voter: &Address, ledger: u32) {
    let key = DataKey::LockedUntil(voter.clone());
    env.storage().persistent().set(&key, &ledger);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_proposal(env: &Env, id: u64) -> Result<Proposal, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(Error::ProposalNotFound)
}

pub fn set_proposal(env: &Env, proposal: &Proposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn has_voted(env: &Env, voter: &Address, proposal_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::HasVoted(voter.clone(), proposal_id))
}

pub fn set_has_voted(env: &Env, voter: &Address, proposal_id: u64) {
    let key = DataKey::HasVoted(voter.clone(), proposal_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
