use crate::types::{ManagerConfig, ReserveState};
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Reserve(Address),
    Assets,
}

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400; // ~30 days
pub const PERSISTENT_BUMP_THRESHOLD: u32 = 100_800; // ~7 days

pub fn get_config(env: &Env) -> Option<ManagerConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &ManagerConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_assets(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Assets)
        .unwrap_or(Vec::new(env))
}

pub fn set_assets(env: &Env, assets: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Assets, assets);
}

pub fn get_reserve_state(env: &Env, asset: &Address) -> Option<ReserveState> {
    let key = DataKey::Reserve(asset.clone());
    let state = env.storage().persistent().get(&key);
    if state.is_some() {
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_BUMP_LEDGERS,
        );
    }
    state
}

pub fn set_reserve_state(env: &Env, asset: &Address, state: &ReserveState) {
    let key = DataKey::Reserve(asset.clone());
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_LEDGERS);
}
