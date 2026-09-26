use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PlayerActivity};

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

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

pub fn set_drip_rate(env: &Env, rate: i128) {
    env.storage().instance().set(&DataKey::DripRatePerLedger, &rate);
}

pub fn get_drip_rate(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::DripRatePerLedger).unwrap()
}

pub fn get_pool_balance(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::DripPoolBalance).unwrap_or(0)
}

pub fn set_pool_balance(env: &Env, balance: i128) {
    env.storage().instance().set(&DataKey::DripPoolBalance, &balance);
}

pub fn add_pool_balance(env: &Env, delta: i128) {
    let balance = get_pool_balance(env);
    set_pool_balance(env, balance + delta);
}

pub fn get_last_drip_ledger(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::LastDripLedger).unwrap_or(0)
}

pub fn set_last_drip_ledger(env: &Env, ledger: u32) {
    env.storage().instance().set(&DataKey::LastDripLedger, &ledger);
}

/// Index of players with recorded activity (drives proportional shares).
pub fn all_active_players(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Players)
        .unwrap_or(soroban_sdk::Vec::new(env))
}

pub fn add_active_player(env: &Env, player: &Address) {
    let mut players = all_active_players(env);
    if !players.contains(player) {
        players.push_back(player.clone());
        env.storage().instance().set(&DataKey::Players, &players);
    }
}

pub fn get_activity(env: &Env, player: &Address) -> PlayerActivity {
    env.storage()
        .persistent()
        .get(&DataKey::Activity(player.clone()))
        .unwrap_or(PlayerActivity {
            volume: 0,
            last_active_ledger: 0,
        })
}

pub fn set_activity(env: &Env, player: &Address, activity: &PlayerActivity) {
    env.storage()
        .persistent()
        .set(&DataKey::Activity(player.clone()), activity);
}

/// Claim watermark: the last ledger for which this player already received a
/// drip share. Claims are always settled up to `env.ledger().sequence() - 1`.
pub fn get_claimed_through(env: &Env, player: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::ClaimedThrough(player.clone()))
        .unwrap_or(0)
}

pub fn set_claimed_through(env: &Env, player: &Address, ledger: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::ClaimedThrough(player.clone()), &ledger);
}

pub fn set_sweep_request(env: &Env, recipient: &Address, eligible_at: u32) {
    env.storage().instance().set(&DataKey::SweepRecipient, recipient);
    env.storage().instance().set(&DataKey::SweepEligibleAt, &eligible_at);
}

pub fn get_sweep_request(env: &Env) -> Option<(Address, u32)> {
    let recipient: Option<Address> = env.storage().instance().get(&DataKey::SweepRecipient);
    let eligible_at: Option<u32> = env.storage().instance().get(&DataKey::SweepEligibleAt);
    match (recipient, eligible_at) {
        (Some(recipient), Some(eligible_at)) => Some((recipient, eligible_at)),
        _ => None,
    }
}

pub fn clear_sweep_request(env: &Env) {
    env.storage().instance().remove(&DataKey::SweepRecipient);
    env.storage().instance().remove(&DataKey::SweepEligibleAt);
}
