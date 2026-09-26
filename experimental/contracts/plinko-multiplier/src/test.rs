#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, BytesN, Env};

const HOUSE_BANKROLL: i128 = 1_000_000_000_000;
const WAGER: i128 = 100_0000000;

fn setup(env: &Env) -> (PlinkoMultiplierClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(PlinkoMultiplier, ());
    let client = PlinkoMultiplierClient::new(env, &contract_id);

    env.mock_all_auths();
    StellarAssetClient::new(env, &token_address).mint(&admin, &HOUSE_BANKROLL);
    client.initialize(&admin, &token_address, &HOUSE_BANKROLL);

    (client, admin, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn seed(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Brute-force search for a seed byte that resolves to the given target
/// bin index for `rows`, so tests can deterministically exercise a
/// specific bin without depending on the internal derivation formula
/// beyond "it's deterministic for a given (seed, drop_id, rows)".
fn find_seed_for_bin(env: &Env, drop_id: u64, rows: u32, target_bin: u32) -> BytesN<32> {
    for byte in 0u8..=255 {
        let candidate = seed(env, byte);
        if derive_bin_index(env, &candidate, drop_id, rows) == target_bin {
            return candidate;
        }
    }
    panic!("no seed byte in 0..=255 resolves to bin {target_bin} for {rows} rows at drop_id {drop_id}; widen the search");
}

// ---------------------------------------------------------------------------
// 1. ball drop path landing in center bin pays partial wager
// ---------------------------------------------------------------------------

#[test]
fn test_ball_drop_landing_in_center_bin_pays_partial_wager() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, WAGER);

    // drop_id will be 1 for the first drop; find a seed landing in the
    // center bin (rows / 2 = 4 for an 8-row board).
    let center_bin = 4;
    let client_seed = find_seed_for_bin(&env, 1, 8, center_bin);

    let result = client.drop_ball(&player, &WAGER, &client_seed, &8);

    assert_eq!(result.bin_index, center_bin);
    assert_eq!(result.multiplier_bps100, 50); // 0.5x for an 8-row center bin
    assert_eq!(result.payout, WAGER / 2);
    assert!(
        result.payout < result.wager,
        "center bin must pay LESS than the wager"
    );

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player), WAGER / 2);
}

// ---------------------------------------------------------------------------
// 2. ball drop path landing in edge bin pays jackpot multiplier
// ---------------------------------------------------------------------------

#[test]
fn test_ball_drop_landing_in_edge_bin_pays_jackpot_multiplier() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, WAGER);

    let edge_bin = 8; // rightmost bin for an 8-row board
    let client_seed = find_seed_for_bin(&env, 1, 8, edge_bin);

    let result = client.drop_ball(&player, &WAGER, &client_seed, &8);

    assert_eq!(result.bin_index, edge_bin);
    assert_eq!(result.multiplier_bps100, 1_000); // 10x for an 8-row edge bin
    assert_eq!(result.payout, WAGER * 10);
    assert!(
        result.payout > result.wager,
        "edge bin must pay MORE than the wager"
    );

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player), WAGER * 10);
}

#[test]
fn test_both_edge_bins_pay_the_same_multiplier() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let table = client.get_bin_multipliers(&8);
    assert_eq!(table.get(0).unwrap(), table.get(8).unwrap());
    assert_eq!(table.get(0).unwrap(), 1_000);
}

#[test]
fn test_multiplier_table_is_symmetric_and_monotonic_from_center() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let table = client.get_bin_multipliers(&12);
    // Symmetric.
    for i in 0..=12u32 {
        assert_eq!(table.get(i).unwrap(), table.get(12 - i).unwrap());
    }
    // Monotonically non-increasing moving TOWARD center (index 6): each
    // step from the edge (index 0) in must pay the same or less.
    for i in 0..6u32 {
        assert!(table.get(i).unwrap() >= table.get(i + 1).unwrap());
    }
}

// ---------------------------------------------------------------------------
// 3. bankroll limitation rejects excessive wagers
// ---------------------------------------------------------------------------

#[test]
fn test_bankroll_limitation_rejects_excessive_wagers() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(PlinkoMultiplier, ());
    let client = PlinkoMultiplierClient::new(&env, &contract_id);

    // A tiny bankroll that can't cover even one max-multiplier (10x)
    // payout on a modest wager.
    let tiny_bankroll = 500i128;
    mint(&env, &token_address, &admin, tiny_bankroll);
    client.initialize(&admin, &token_address, &tiny_bankroll);

    let player = Address::generate(&env);
    let big_wager = 1_000i128; // 10x of this exceeds the bankroll
    mint(&env, &token_address, &player, big_wager);

    let client_seed = seed(&env, 1);
    let result = client.try_drop_ball(&player, &big_wager, &client_seed, &8);
    assert_eq!(result, Err(Ok(Error::WagerExceedsBankrollLimit)));

    // No funds should have moved for the rejected wager.
    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player), big_wager);
}

#[test]
fn test_a_wager_within_bankroll_limits_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, WAGER);

    let client_seed = seed(&env, 1);
    let result = client.try_drop_ball(&player, &WAGER, &client_seed, &8);
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_drop_ball_rejects_unsupported_row_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, WAGER);

    let client_seed = seed(&env, 1);
    let result = client.try_drop_ball(&player, &WAGER, &client_seed, &10);
    assert_eq!(result, Err(Ok(Error::UnsupportedRowCount)));
}

#[test]
fn test_drop_ball_rejects_non_positive_wager() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let client_seed = seed(&env, 1);
    let result = client.try_drop_ball(&player, &0, &client_seed, &8);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_get_bin_multipliers_rejects_unsupported_row_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let result = client.try_get_bin_multipliers(&7);
    assert_eq!(result, Err(Ok(Error::UnsupportedRowCount)));
}

#[test]
fn test_bin_index_is_deterministic_for_the_same_seed_and_drop_id() {
    let env = Env::default();
    let client_seed = seed(&env, 42);
    let bin1 = derive_bin_index(&env, &client_seed, 1, 8);
    let bin2 = derive_bin_index(&env, &client_seed, 1, 8);
    assert_eq!(bin1, bin2);
}

#[test]
fn test_16_row_board_pays_the_highest_edge_multiplier() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let table_16 = client.get_bin_multipliers(&16);
    assert_eq!(table_16.get(0).unwrap(), 5_000); // 50x

    let table_8 = client.get_bin_multipliers(&8);
    assert_eq!(table_8.get(0).unwrap(), 1_000); // 10x

    assert!(table_16.get(0).unwrap() > table_8.get(0).unwrap());
}

#[test]
fn test_fund_and_sweep_bankroll() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    mint(&env, &token_address, &admin, 1_000);
    client.fund_bankroll(&admin, &1_000);
    assert_eq!(client.get_bankroll(), HOUSE_BANKROLL + 1_000);

    client.sweep_bankroll(&admin, &1_000);
    assert_eq!(client.get_bankroll(), HOUSE_BANKROLL);
}

#[test]
fn test_sweep_bankroll_rejects_amount_exceeding_bankroll() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    let result = client.try_sweep_bankroll(&admin, &(HOUSE_BANKROLL + 1));
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let result = client.try_initialize(&admin, &token_address, &HOUSE_BANKROLL);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
