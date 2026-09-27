//! Storage helpers for the lottery pot contract.

use soroban_sdk::{vec, Address, Env, Vec};

use crate::types::{DataKey, Epoch, Error, TicketRange, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_epoch_id(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::EpochId).unwrap_or(0)
}

pub fn set_epoch_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::EpochId, &id);
}

pub fn get_epoch(env: &Env, id: u64) -> Result<Epoch, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Epoch(id))
        .ok_or(Error::NotInitialized)
}

pub fn set_epoch(env: &Env, epoch: &Epoch) {
    let key = DataKey::Epoch(epoch.id);
    env.storage().persistent().set(&key, epoch);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_player_tickets(env: &Env, epoch_id: u64, player: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PlayerTickets(epoch_id, player.clone()))
        .unwrap_or(0)
}

pub fn set_player_tickets(env: &Env, epoch_id: u64, player: &Address, count: u64) {
    let key = DataKey::PlayerTickets(epoch_id, player.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_ticket_ranges(env: &Env, epoch_id: u64) -> Vec<TicketRange> {
    env.storage()
        .persistent()
        .get(&DataKey::TicketRanges(epoch_id))
        .unwrap_or_else(|| vec![env])
}

pub fn append_ticket_range(env: &Env, epoch_id: u64, range: &TicketRange) {
    let mut ranges = get_ticket_ranges(env, epoch_id);
    ranges.push_back(range.clone());
    let key = DataKey::TicketRanges(epoch_id);
    env.storage().persistent().set(&key, &ranges);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn is_refunded(env: &Env, epoch_id: u64, player: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Refunded(epoch_id, player.clone()))
}

pub fn set_refunded(env: &Env, epoch_id: u64, player: &Address) {
    let key = DataKey::Refunded(epoch_id, player.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
