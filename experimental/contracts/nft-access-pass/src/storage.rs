use soroban_sdk::{Address, BytesN, Env};

use crate::types::{AccessPass, DataKey, Error};

pub fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_nft_contract(env: &Env, nft_contract: &Address) {
    env.storage().instance().set(&DataKey::NftContract, nft_contract);
}

pub fn get_nft_contract(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::NftContract).unwrap()
}

pub fn save_pass(env: &Env, ticket_id: &BytesN<32>, pass: &AccessPass) {
    env.storage().persistent().set(&DataKey::Pass(ticket_id.clone()), pass);
}

pub fn load_pass(env: &Env, ticket_id: &BytesN<32>) -> Result<AccessPass, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Pass(ticket_id.clone()))
        .ok_or(Error::PassNotFound)
}
