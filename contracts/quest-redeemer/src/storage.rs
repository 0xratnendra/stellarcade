use crate::types::RedeemerConfig;
use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Verifier,
    Completion(Address, u32), // (Player, QuestId)
    Redemption(Address, u32), // (User, QuestId)
}

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400; // ~30 days
pub const PERSISTENT_BUMP_THRESHOLD: u32 = 100_800; // ~7 days

pub fn get_config(env: &Env) -> Option<RedeemerConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &RedeemerConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_verifier(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Verifier)
}

pub fn set_verifier(env: &Env, verifier: &Address) {
    env.storage().instance().set(&DataKey::Verifier, verifier);
}

pub fn has_completion(env: &Env, player: &Address, quest_id: u32) -> bool {
    let key = DataKey::Completion(player.clone(), quest_id);
    env.storage().persistent().has(&key)
}

pub fn record_completion(env: &Env, player: &Address, quest_id: u32) {
    let key = DataKey::Completion(player.clone(), quest_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_LEDGERS);
}

pub fn has_redeemed(env: &Env, user: &Address, quest_id: u32) -> bool {
    let key = DataKey::Redemption(user.clone(), quest_id);
    env.storage().persistent().has(&key)
}

pub fn record_redemption(env: &Env, user: &Address, quest_id: u32) {
    let key = DataKey::Redemption(user.clone(), quest_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_LEDGERS);
}
