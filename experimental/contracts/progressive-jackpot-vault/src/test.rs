#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env};

const SEED: i128 = 10_000_000_000;

fn setup(env: &Env) -> (ProgressiveJackpotVaultClient<'_>, Address, Address, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(ProgressiveJackpotVault, ());
    let client = ProgressiveJackpotVaultClient::new(env, &contract_id);

    let admin = Address::generate(env);
    mint(env, &token_address, &admin, SEED);
    client.initialize(&admin, &token_address, &SEED);

    (client, admin, token_address, contract_id)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn setup_with_game(
    env: &Env,
) -> (
    ProgressiveJackpotVaultClient<'_>,
    Address,
    Address,
    Address,
    Address,
) {
    let (client, admin, token_address, contract_id) = setup(env);
    let game = Address::generate(env);
    client.add_game(&admin, &game);
    (client, admin, token_address, contract_id, game)
}

// ---------------------------------------------------------------------------
// 1. registered games can deposit contributions to jackpot
// ---------------------------------------------------------------------------

#[test]
fn test_registered_game_can_deposit_contributions_to_jackpot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id, game) = setup_with_game(&env);

    mint(&env, &token_address, &game, 50_0000000);
    let new_pot = client.contribute(&game, &50_0000000);

    assert_eq!(new_pot, SEED + 50_0000000);
    assert_eq!(client.get_pot(), SEED + 50_0000000);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&game), 0);
}

#[test]
fn test_multiple_contributions_accumulate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id, game) = setup_with_game(&env);

    mint(&env, &token_address, &game, 100_0000000);
    client.contribute(&game, &30_0000000);
    client.contribute(&game, &20_0000000);

    assert_eq!(client.get_pot(), SEED + 50_0000000);
}

// ---------------------------------------------------------------------------
// 2. unauthorized contracts are rejected on contribute
// ---------------------------------------------------------------------------

#[test]
fn test_unauthorized_contract_rejected_on_contribute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id) = setup(&env);

    let rogue = Address::generate(&env);
    mint(&env, &token_address, &rogue, 50_0000000);

    let result = client.try_contribute(&rogue, &50_0000000);
    assert_eq!(result, Err(Ok(Error::GameNotWhitelisted)));
    assert_eq!(client.get_pot(), SEED);
}

#[test]
fn test_contribute_rejects_non_positive_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id, game) = setup_with_game(&env);

    let result = client.try_contribute(&game, &0);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

// ---------------------------------------------------------------------------
// 3. claim jackpot correctly computes tier percentage and transfers tokens
// ---------------------------------------------------------------------------

#[test]
fn test_claim_mini_jackpot_pays_ten_percent_of_pot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id, game) = setup_with_game(&env);

    let winner = Address::generate(&env);
    let payout = client.claim_jackpot(&game, &winner, &JackpotTier::Mini);

    assert_eq!(payout, SEED / 10);
    assert_eq!(client.get_pot(), SEED - SEED / 10);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&winner), SEED / 10);
}

#[test]
fn test_claim_major_jackpot_pays_fifty_percent_of_pot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id, game) = setup_with_game(&env);

    let winner = Address::generate(&env);
    let payout = client.claim_jackpot(&game, &winner, &JackpotTier::Major);

    assert_eq!(payout, SEED / 2);
    assert_eq!(client.get_pot(), SEED - SEED / 2);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&winner), SEED / 2);
}

#[test]
fn test_claim_mega_jackpot_pays_full_pot_and_reseeds_reserve() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, _contract_id, game) = setup_with_game(&env);

    // Grow the pot past the seed amount first, so the re-seed is visibly
    // a reset rather than a no-op.
    mint(&env, &token_address, &game, 200_0000000);
    client.contribute(&game, &200_0000000);
    assert_eq!(client.get_pot(), SEED + 200_0000000);

    let winner = Address::generate(&env);
    let payout = client.claim_jackpot(&game, &winner, &JackpotTier::Mega);

    assert_eq!(payout, SEED + 200_0000000);
    // Re-seeded back to the original seed amount, not zero.
    assert_eq!(client.get_pot(), SEED);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&winner), SEED + 200_0000000);
    let _ = admin;
}

#[test]
fn test_claim_jackpot_by_unwhitelisted_game_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id) = setup(&env);

    let rogue = Address::generate(&env);
    let winner = Address::generate(&env);
    let result = client.try_claim_jackpot(&rogue, &winner, &JackpotTier::Mini);
    assert_eq!(result, Err(Ok(Error::GameNotWhitelisted)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, _contract_id) = setup(&env);

    mint(&env, &token_address, &admin, SEED);
    let result = client.try_initialize(&admin, &token_address, &SEED);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_rejects_negative_seed() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let contract_id = env.register(ProgressiveJackpotVault, ());
    let client = ProgressiveJackpotVaultClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &token_contract_id.address(), &-1);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_add_game_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id) = setup(&env);

    let impostor = Address::generate(&env);
    let game = Address::generate(&env);
    let result = client.try_add_game(&impostor, &game);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_add_game_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address, _contract_id, game) = setup_with_game(&env);

    let result = client.try_add_game(&admin, &game);
    assert_eq!(result, Err(Ok(Error::GameAlreadyWhitelisted)));
}

#[test]
fn test_is_game_whitelisted_reflects_registration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id, game) = setup_with_game(&env);

    assert!(client.is_game_whitelisted(&game));

    let other = Address::generate(&env);
    assert!(!client.is_game_whitelisted(&other));
}

#[test]
fn test_claim_jackpot_on_a_drained_pot_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id, game) = setup_with_game(&env);

    let winner = Address::generate(&env);
    client.claim_jackpot(&game, &winner, &JackpotTier::Mega);
    assert_eq!(client.get_pot(), SEED);

    // Drain the re-seeded pot too, this time with nothing left afterward.
    // A Mega claim always re-seeds, so force an empty pot scenario by
    // claiming from a freshly initialized vault with a zero seed instead.
    // Everything here, including `winner`, must be generated against this
    // scenario's own Env: an Address (or any other host object) created
    // under one Env is not a valid reference inside a different Env.
    let env2 = Env::default();
    env2.mock_all_auths();
    let token_admin = Address::generate(&env2);
    let token_contract_id = env2.register_stellar_asset_contract_v2(token_admin);
    let contract_id = env2.register(ProgressiveJackpotVault, ());
    let zero_client = ProgressiveJackpotVaultClient::new(&env2, &contract_id);
    let admin2 = Address::generate(&env2);
    zero_client.initialize(&admin2, &token_contract_id.address(), &0);
    let zero_game = Address::generate(&env2);
    zero_client.add_game(&admin2, &zero_game);
    let zero_winner = Address::generate(&env2);

    let result = zero_client.try_claim_jackpot(&zero_game, &zero_winner, &JackpotTier::Mini);
    assert_eq!(result, Err(Ok(Error::EmptyPot)));
}
