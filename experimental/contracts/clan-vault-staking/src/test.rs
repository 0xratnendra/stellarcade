#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, String,
};

fn setup(env: &Env) -> (ClanVaultStakingClient<'_>, Address, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(ClanVaultStaking, ());
    let client = ClanVaultStakingClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&token_address);

    let leader = Address::generate(env);
    client.create_clan(&leader, &String::from_str(env, "clan-alpha"));

    (client, leader, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. member can stake tokens and receive shares
// ---------------------------------------------------------------------------

#[test]
fn test_member_can_stake_and_receive_recorded_shares() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    mint(&env, &token_address, &member, 10_000_000_000);

    client.stake(&member, &clan_id, &10_000_000_000, &(30 * 86_400));

    let stake = client.get_stake(&clan_id, &member).unwrap();
    assert_eq!(stake.amount, 10_000_000_000);
    assert_eq!(stake.multiplier_bps, 10_000);

    let clan = client.get_clan(&clan_id);
    assert_eq!(clan.total_staked, 10_000_000_000);
    assert_eq!(clan.total_weight, 10_000_000_000u128 * 10_000);
}

#[test]
fn test_stake_rejects_invalid_lock_duration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    mint(&env, &token_address, &member, 10_000_000_000);

    let result = client.try_stake(&member, &clan_id, &10_000_000_000, &(45 * 86_400));
    assert_eq!(result, Err(Ok(Error::InvalidLockDuration)));
}

// ---------------------------------------------------------------------------
// 2. dividend distribution increases claimable balance proportionally
// ---------------------------------------------------------------------------

#[test]
fn test_dividend_distribution_increases_claimable_proportionally() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    // member_a: 1000 tokens @ 30d (1.0x) -> weight 1000 * 10000 = 10_000_000
    let member_a = Address::generate(&env);
    mint(&env, &token_address, &member_a, 10_000_000_000);
    client.stake(&member_a, &clan_id, &10_000_000_000, &(30 * 86_400));

    // member_b: 1000 tokens @ 180d (1.5x) -> weight 1000 * 15000 = 15_000_000
    let member_b = Address::generate(&env);
    mint(&env, &token_address, &member_b, 10_000_000_000);
    client.stake(&member_b, &clan_id, &10_000_000_000, &(180 * 86_400));

    // Total weight = 25_000_000. member_a's share = 10/25 = 40%, member_b's = 60%.
    mint(&env, &token_address, &leader, 10_000_000_000);
    let reward = 5_000_000_000i128;
    client.distribute_dividends(&leader, &clan_id, &reward);

    let claimable_a = client.get_claimable(&clan_id, &member_a);
    let claimable_b = client.get_claimable(&clan_id, &member_b);

    assert_eq!(claimable_a, reward * 10_000_000 / 25_000_000);
    assert_eq!(claimable_b, reward * 15_000_000 / 25_000_000);
    assert_eq!(claimable_a + claimable_b, reward);
}

#[test]
fn test_only_leader_can_distribute_dividends() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    mint(&env, &token_address, &member, 10_000_000_000);
    client.stake(&member, &clan_id, &10_000_000_000, &(30 * 86_400));

    let outsider = Address::generate(&env);
    mint(&env, &token_address, &outsider, 10_000_000_000);

    let result = client.try_distribute_dividends(&outsider, &clan_id, &100_0000000);
    assert_eq!(result, Err(Ok(Error::NotClanLeader)));
}

#[test]
fn test_claim_dividends_pays_out_and_resets_claimable() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    let member_starting_balance = 20_000_000_000;
    let stake_amount = 10_000_000_000;
    mint(&env, &token_address, &member, member_starting_balance);
    client.stake(&member, &clan_id, &stake_amount, &(30 * 86_400));

    mint(&env, &token_address, &leader, 10_000_000_000);
    client.distribute_dividends(&leader, &clan_id, &5_000_000_000);

    let claimed = client.claim_dividends(&member, &clan_id);
    assert_eq!(claimed, 5_000_000_000);
    assert_eq!(client.get_claimable(&clan_id, &member), 0);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(
        token_client.balance(&member),
        member_starting_balance - stake_amount + 5_000_000_000
    );
}

// ---------------------------------------------------------------------------
// 3. early unstake attempt returns an error
// ---------------------------------------------------------------------------

#[test]
fn test_early_unstake_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    mint(&env, &token_address, &member, 10_000_000_000);
    client.stake(&member, &clan_id, &10_000_000_000, &(30 * 86_400));

    let result = client.try_unstake(&member, &clan_id);
    assert_eq!(result, Err(Ok(Error::LockNotYetExpired)));
}

#[test]
fn test_unstake_after_lock_expires_releases_principal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _leader, token_address) = setup(&env);
    let clan_id = String::from_str(&env, "clan-alpha");

    let member = Address::generate(&env);
    mint(&env, &token_address, &member, 10_000_000_000);
    client.stake(&member, &clan_id, &10_000_000_000, &(30 * 86_400));

    env.ledger().with_mut(|l| l.timestamp += 30 * 86_400 + 1);
    let released = client.unstake(&member, &clan_id);
    assert_eq!(released, 10_000_000_000);

    assert!(client.get_stake(&clan_id, &member).is_none());

    let clan = client.get_clan(&clan_id);
    assert_eq!(clan.total_staked, 0);
    assert_eq!(clan.total_weight, 0);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&member), 10_000_000_000);
}
