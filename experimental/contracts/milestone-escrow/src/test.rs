#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env};

const MILESTONE_10_WINS: u64 = 10;
const MILESTONE_50_WINS: u64 = 50;
const REWARD_10_WINS: i128 = 10_0000000;
const REWARD_50_WINS: i128 = 50_0000000;

fn setup(env: &Env) -> (MilestoneEscrowClient<'_>, Address, Address, Address) {
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(MilestoneEscrow, ());
    let client = MilestoneEscrowClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &oracle, &token_address);
    client.configure_milestone(&admin, &MILESTONE_10_WINS, &REWARD_10_WINS);
    client.configure_milestone(&admin, &MILESTONE_50_WINS, &REWARD_50_WINS);

    (client, admin, oracle, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. oracle verification unlocks milestone claim
// ---------------------------------------------------------------------------

#[test]
fn test_oracle_verification_unlocks_milestone_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, oracle, token_address) = setup(&env);

    let sponsor = Address::generate(&env);
    mint(&env, &token_address, &sponsor, 10_000_000_000);
    client.deposit_pool(&sponsor, &100_0000000);

    let player = Address::generate(&env);
    assert!(!client.is_milestone_verified(&player, &MILESTONE_10_WINS));

    client.verify_milestone(&oracle, &player, &MILESTONE_10_WINS);
    assert!(client.is_milestone_verified(&player, &MILESTONE_10_WINS));

    let claimed = client.claim_reward(&player, &MILESTONE_10_WINS);
    assert_eq!(claimed, REWARD_10_WINS);
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token_address).balance(&player),
        REWARD_10_WINS
    );
}

#[test]
fn test_claim_without_verification_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _oracle, token_address) = setup(&env);

    let sponsor = Address::generate(&env);
    mint(&env, &token_address, &sponsor, 10_000_000_000);
    client.deposit_pool(&sponsor, &100_0000000);

    let player = Address::generate(&env);
    let result = client.try_claim_reward(&player, &MILESTONE_10_WINS);
    assert_eq!(result, Err(Ok(Error::MilestoneNotVerified)));
}

// ---------------------------------------------------------------------------
// 2. double-claim attempt is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_double_claim_attempt_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, oracle, token_address) = setup(&env);

    let sponsor = Address::generate(&env);
    mint(&env, &token_address, &sponsor, 10_000_000_000);
    client.deposit_pool(&sponsor, &100_0000000);

    let player = Address::generate(&env);
    client.verify_milestone(&oracle, &player, &MILESTONE_10_WINS);
    client.claim_reward(&player, &MILESTONE_10_WINS);

    let result = client.try_claim_reward(&player, &MILESTONE_10_WINS);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));

    // A different milestone for the same player is unaffected.
    client.verify_milestone(&oracle, &player, &MILESTONE_50_WINS);
    let second_claim = client.claim_reward(&player, &MILESTONE_50_WINS);
    assert_eq!(second_claim, REWARD_50_WINS);
}

// ---------------------------------------------------------------------------
// 3. unauthorized oracle verification rejection
// ---------------------------------------------------------------------------

#[test]
fn test_unauthorized_oracle_verification_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _oracle, _token_address) = setup(&env);

    let impostor = Address::generate(&env);
    let player = Address::generate(&env);
    let result = client.try_verify_milestone(&impostor, &player, &MILESTONE_10_WINS);
    assert_eq!(result, Err(Ok(Error::NotOracle)));
    assert!(!client.is_milestone_verified(&player, &MILESTONE_10_WINS));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_verify_unconfigured_milestone_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, oracle, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let result = client.try_verify_milestone(&oracle, &player, &999);
    assert_eq!(result, Err(Ok(Error::MilestoneNotConfigured)));
}

#[test]
fn test_verify_milestone_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, oracle, _token_address) = setup(&env);

    let player = Address::generate(&env);
    client.verify_milestone(&oracle, &player, &MILESTONE_10_WINS);
    // Verifying again must not error or change claimed state.
    client.verify_milestone(&oracle, &player, &MILESTONE_10_WINS);
    assert!(client.is_milestone_verified(&player, &MILESTONE_10_WINS));
    assert!(!client.is_milestone_claimed(&player, &MILESTONE_10_WINS));
}

#[test]
fn test_claim_rejected_when_pool_insufficient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, oracle, token_address) = setup(&env);

    // Deposit less than the configured reward.
    let sponsor = Address::generate(&env);
    mint(&env, &token_address, &sponsor, 5_0000000);
    client.deposit_pool(&sponsor, &5_0000000);

    let player = Address::generate(&env);
    client.verify_milestone(&oracle, &player, &MILESTONE_10_WINS);

    let result = client.try_claim_reward(&player, &MILESTONE_10_WINS);
    assert_eq!(result, Err(Ok(Error::InsufficientPool)));
}

#[test]
fn test_configure_milestone_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _oracle, _token_address) = setup(&env);

    let not_admin = Address::generate(&env);
    let result = client.try_configure_milestone(&not_admin, &1, &10_0000000);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_configure_milestone_rejects_non_positive_reward() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _oracle, _token_address) = setup(&env);

    let result = client.try_configure_milestone(&admin, &1, &0);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_deposit_pool_increases_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _oracle, token_address) = setup(&env);

    let sponsor = Address::generate(&env);
    mint(&env, &token_address, &sponsor, 10_000_000_000);

    client.deposit_pool(&sponsor, &50_0000000);
    assert_eq!(client.get_pool_balance(), 50_0000000);

    client.deposit_pool(&sponsor, &25_0000000);
    assert_eq!(client.get_pool_balance(), 75_0000000);
}

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, oracle, token_address) = setup(&env);

    let result = client.try_initialize(&admin, &oracle, &token_address);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
