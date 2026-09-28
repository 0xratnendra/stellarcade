//! Storage helpers for the ticket raffle escrow contract.

use soroban_sdk::{vec, Address, Env, Vec};

use crate::types::{DataKey, Error, Raffle, TicketRange, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_next_raffle_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextRaffleId)
        .unwrap_or(1)
}

pub fn set_next_raffle_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextRaffleId, &id);
}

pub fn get_raffle(env: &Env, id: u64) -> Result<Raffle, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Raffle(id))
        .ok_or(Error::RaffleNotFound)
}

pub fn set_raffle(env: &Env, raffle: &Raffle) {
    let key = DataKey::Raffle(raffle.id);
    env.storage().persistent().set(&key, raffle);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_player_tickets(env: &Env, raffle_id: u64, player: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PlayerTickets(raffle_id, player.clone()))
        .unwrap_or(0)
}

pub fn set_player_tickets(env: &Env, raffle_id: u64, player: &Address, count: u64) {
    let key = DataKey::PlayerTickets(raffle_id, player.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_ticket_ranges(env: &Env, raffle_id: u64) -> Vec<TicketRange> {
    env.storage()
        .persistent()
        .get(&DataKey::TicketRanges(raffle_id))
        .unwrap_or_else(|| vec![env])
}

pub fn append_ticket_range(env: &Env, raffle_id: u64, range: &TicketRange) {
    let mut ranges = get_ticket_ranges(env, raffle_id);
    ranges.push_back(range.clone());
    let key = DataKey::TicketRanges(raffle_id);
    env.storage().persistent().set(&key, &ranges);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}
