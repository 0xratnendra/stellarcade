//! Storage helpers for the clan vault staking contract.

use soroban_sdk::{vec, Address, Env, String, Vec};

use crate::types::{Clan, DataKey, Error, MemberStake, PERSISTENT_BUMP_LEDGERS};

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

pub fn get_clan(env: &Env, clan_id: &String) -> Result<Clan, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Clan(clan_id.clone()))
        .ok_or(Error::ClanNotFound)
}

pub fn has_clan(env: &Env, clan_id: &String) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Clan(clan_id.clone()))
}

pub fn set_clan(env: &Env, clan: &Clan) {
    let key = DataKey::Clan(clan.clan_id.clone());
    env.storage().persistent().set(&key, clan);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_stake(env: &Env, clan_id: &String, member: &Address) -> Option<MemberStake> {
    env.storage()
        .persistent()
        .get(&DataKey::Stake(clan_id.clone(), member.clone()))
}

pub fn set_stake(env: &Env, stake: &MemberStake) {
    let key = DataKey::Stake(stake.clan_id.clone(), stake.member.clone());
    env.storage().persistent().set(&key, stake);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn remove_stake(env: &Env, clan_id: &String, member: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Stake(clan_id.clone(), member.clone()));
}

pub fn get_claimable(env: &Env, clan_id: &String, member: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Claimable(clan_id.clone(), member.clone()))
        .unwrap_or(0)
}

pub fn set_claimable(env: &Env, clan_id: &String, member: &Address, amount: i128) {
    let key = DataKey::Claimable(clan_id.clone(), member.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

pub fn get_clan_members(env: &Env, clan_id: &String) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::ClanMembers(clan_id.clone()))
        .unwrap_or_else(|| vec![env])
}

fn set_clan_members(env: &Env, clan_id: &String, members: &Vec<Address>) {
    let key = DataKey::ClanMembers(clan_id.clone());
    env.storage().persistent().set(&key, members);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);
}

/// Adds `member` to `clan_id`'s member index if not already present.
pub fn add_clan_member(env: &Env, clan_id: &String, member: &Address) {
    let mut members = get_clan_members(env, clan_id);
    if !members.contains(member) {
        members.push_back(member.clone());
        set_clan_members(env, clan_id, &members);
    }
}

/// Removes `member` from `clan_id`'s member index.
pub fn remove_clan_member(env: &Env, clan_id: &String, member: &Address) {
    let members = get_clan_members(env, clan_id);
    if let Some(index) = members.iter().position(|m| &m == member) {
        let mut members = members;
        members.remove(index as u32);
        set_clan_members(env, clan_id, &members);
    }
}
