#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec, Address, Env};

fn tiers(env: &Env) -> Vec<RewardTier> {
    vec![
        env,
        RewardTier {
            min_referrals: 0,
            reward_bps: 500,
        }, // 5% base
        RewardTier {
            min_referrals: 5,
            reward_bps: 1_000,
        }, // 10% at 5+ referrals
        RewardTier {
            min_referrals: 20,
            reward_bps: 1_500,
        }, // 15% at 20+ referrals
    ]
}

fn setup(env: &Env) -> (ReferralRewardsClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(ReferralRewards, ());
    let client = ReferralRewardsClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &token_address, &tiers(env));

    (client, admin, token_address)
}

fn fund_contract(env: &Env, token_address: &Address, contract_id: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(contract_id, &amount);
}

// ---------------------------------------------------------------------------
// 1. binding referrer accumulates reward on player wager fee
// ---------------------------------------------------------------------------

#[test]
fn test_binding_referrer_accumulates_reward_on_player_wager_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    let game_contract = Address::generate(&env);
    client.authorize_caller(&admin, &game_contract);

    let player = Address::generate(&env);
    let referrer = Address::generate(&env);
    client.register_referrer(&player, &referrer);

    let reward = client.record_wager_fee(&game_contract, &player, &10_000_000_000);
    // Base tier: referrer has 1 referral (< 5), so 5% of fee.
    assert_eq!(reward, 50_0000000);
    assert_eq!(client.get_claimable(&referrer), 50_0000000);
}

#[test]
fn test_record_wager_fee_is_a_no_op_for_a_player_with_no_referrer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    let game_contract = Address::generate(&env);
    client.authorize_caller(&admin, &game_contract);

    let player = Address::generate(&env);
    let reward = client.record_wager_fee(&game_contract, &player, &10_000_000_000);
    assert_eq!(reward, 0);
}

#[test]
fn test_reward_scales_with_referral_tier() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    let game_contract = Address::generate(&env);
    client.authorize_caller(&admin, &game_contract);

    let referrer = Address::generate(&env);
    // Bind 5 distinct players to reach the 10% tier.
    for _ in 0..5 {
        let player = Address::generate(&env);
        client.register_referrer(&player, &referrer);
    }
    assert_eq!(client.get_referral_count(&referrer), 5);

    let another_player = Address::generate(&env);
    client.register_referrer(&another_player, &referrer);
    let reward = client.record_wager_fee(&game_contract, &another_player, &10_000_000_000);
    // 6 referrals now: qualifies for the 10% tier (min_referrals: 5).
    assert_eq!(reward, 100_0000000);
}

#[test]
fn test_record_wager_fee_by_unauthorized_caller_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let not_a_game_contract = Address::generate(&env);
    let player = Address::generate(&env);
    let result = client.try_record_wager_fee(&not_a_game_contract, &player, &1_000);
    assert_eq!(result, Err(Ok(Error::NotAuthorizedCaller)));
}

// ---------------------------------------------------------------------------
// 2. self-referral attempt is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_self_referral_attempt_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let result = client.try_register_referrer(&player, &player);
    assert_eq!(result, Err(Ok(Error::SelfReferralNotAllowed)));
}

#[test]
fn test_circular_referral_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);

    // A refers B first...
    client.register_referrer(&player_a, &player_b);
    // ...then B attempting to refer A (who is B's own referrer) would be
    // circular: A -> B -> A.
    let result = client.try_register_referrer(&player_b, &player_a);
    assert_eq!(result, Err(Ok(Error::CircularReferralNotAllowed)));
}

#[test]
fn test_re_registering_an_already_bound_referrer_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let referrer_1 = Address::generate(&env);
    let referrer_2 = Address::generate(&env);

    client.register_referrer(&player, &referrer_1);
    let result = client.try_register_referrer(&player, &referrer_2);
    assert_eq!(result, Err(Ok(Error::ReferrerAlreadySet)));

    // The original binding must remain unchanged.
    assert_eq!(client.get_referrer_of(&player), Some(referrer_1));
}

// ---------------------------------------------------------------------------
// 3. referrer claims accumulated rewards successfully
// ---------------------------------------------------------------------------

#[test]
fn test_referrer_claims_accumulated_rewards_successfully() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let contract_id = client.address.clone();
    fund_contract(&env, &token_address, &contract_id, 10_000_000_000);

    let game_contract = Address::generate(&env);
    client.authorize_caller(&admin, &game_contract);

    let player = Address::generate(&env);
    let referrer = Address::generate(&env);
    client.register_referrer(&player, &referrer);
    client.record_wager_fee(&game_contract, &player, &10_000_000_000);

    let claimed = client.claim_referral_earnings(&referrer);
    assert_eq!(claimed, 50_0000000);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&referrer), 50_0000000);
    assert_eq!(client.get_claimable(&referrer), 0);
}

#[test]
fn test_claim_with_nothing_accumulated_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let referrer = Address::generate(&env);
    let result = client.try_claim_referral_earnings(&referrer);
    assert_eq!(result, Err(Ok(Error::NothingToClaim)));
}

#[test]
fn test_claiming_twice_only_pays_out_once() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let contract_id = client.address.clone();
    fund_contract(&env, &token_address, &contract_id, 10_000_000_000);

    let game_contract = Address::generate(&env);
    client.authorize_caller(&admin, &game_contract);

    let player = Address::generate(&env);
    let referrer = Address::generate(&env);
    client.register_referrer(&player, &referrer);
    client.record_wager_fee(&game_contract, &player, &10_000_000_000);

    client.claim_referral_earnings(&referrer);
    let result = client.try_claim_referral_earnings(&referrer);
    assert_eq!(result, Err(Ok(Error::NothingToClaim)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_rejects_tiers_without_a_zero_referral_base_tier() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(ReferralRewards, ());
    let client = ReferralRewardsClient::new(&env, &contract_id);

    let bad_tiers = vec![
        &env,
        RewardTier {
            min_referrals: 1,
            reward_bps: 500,
        },
    ];
    let result = client.try_initialize(&admin, &token_address, &bad_tiers);
    assert_eq!(result, Err(Ok(Error::InvalidTiers)));
}

#[test]
fn test_authorize_caller_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let not_admin = Address::generate(&env);
    let some_contract = Address::generate(&env);
    let result = client.try_authorize_caller(&not_admin, &some_contract);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let result = client.try_initialize(&admin, &token_address, &tiers(&env));
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
