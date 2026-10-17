use crate::types::LobbyData;
use soroban_sdk::{contracttype, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    Lobby(u64),
    Paused,
    StartGraceBlocks(u64),
}

pub fn get_admin(env: &Env) -> Option<soroban_sdk::Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &soroban_sdk::Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_lobby(env: &Env, lobby_id: u64) -> Option<LobbyData> {
    env.storage().persistent().get(&DataKey::Lobby(lobby_id))
}

pub fn set_lobby(env: &Env, lobby_id: u64, data: &LobbyData) {
    env.storage()
        .persistent()
        .set(&DataKey::Lobby(lobby_id), data);
}

pub fn get_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn get_start_grace_blocks(env: &Env, lobby_id: u64) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::StartGraceBlocks(lobby_id))
}

pub fn set_start_grace_blocks(env: &Env, lobby_id: u64, grace_blocks: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::StartGraceBlocks(lobby_id), &grace_blocks);
}
