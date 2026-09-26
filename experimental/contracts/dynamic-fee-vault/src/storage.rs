use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, PlayerVolume, WINDOW_LEDGERS};

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

/// Load a player's volume, decaying the window first: an expired window
/// resets to zero volume with a fresh window start (rolling 30-day totals).
pub fn load_player_volume(env: &Env, player: &Address) -> PlayerVolume {
    let now = env.ledger().sequence();
    match env.storage().persistent().get(&DataKey::Player(player.clone())) {
        Some(volume) => {
            let mut volume: PlayerVolume = volume;
            if now.saturating_sub(volume.window_start_ledger) >= WINDOW_LEDGERS {
                volume.window_start_ledger = now;
                volume.total_volume = 0;
            }
            volume
        }
        None => PlayerVolume {
            window_start_ledger: now,
            total_volume: 0,
        },
    }
}

pub fn save_player_volume(env: &Env, player: &Address, volume: &PlayerVolume) {
    env.storage()
        .persistent()
        .set(&DataKey::Player(player.clone()), volume);
}

pub fn add_fees_collected(env: &Env, amount: i128) {
    let current: i128 = env.storage().instance().get(&DataKey::FeesCollected).unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::FeesCollected, &(current + amount));
}

pub fn get_fees_collected(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::FeesCollected).unwrap_or(0)
}

pub fn set_fees_collected(env: &Env, amount: i128) {
    env.storage().instance().set(&DataKey::FeesCollected, &amount);
}
