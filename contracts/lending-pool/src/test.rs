use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup_client(env: &Env) -> (LendingPoolClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register_contract(None, LendingPool);
    let client = LendingPoolClient::new(env, &contract_id);
    client.init(&admin, &900);
    (client, admin)
}

#[test]
fn test_utilization_and_buffer_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_client(&env);

    client.set_pool_totals(&admin, &1_000, &250);
    let utilization = client.utilization_snapshot();
    assert!(utilization.configured);
    assert_eq!(utilization.available_liquidity, 750);
    assert_eq!(utilization.utilization_bps, 2_500);

    let buffer = client.liquidation_buffer_snapshot();
    assert_eq!(buffer.liquidation_buffer_bps, 900);
    assert!(buffer.has_borrow_exposure);
}

#[test]
fn test_unconfigured_returns_predictable_zero_snapshot() {
    let env = Env::default();
    let contract_id = env.register_contract(None, LendingPool);
    let client = LendingPoolClient::new(&env, &contract_id);

    let utilization = client.utilization_snapshot();
    assert!(!utilization.configured);
    assert_eq!(utilization.total_supplied, 0);
    assert_eq!(utilization.utilization_bps, 0);

    let buffer = client.liquidation_buffer_snapshot();
    assert!(!buffer.configured);
    assert_eq!(buffer.liquidation_buffer_bps, 0);
    assert!(!buffer.has_borrow_exposure);
}

// ── pool_utilization_snapshot ────────────────────────────────────────────────

#[test]
fn test_pool_utilization_snapshot_healthy() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_client(&env);
    // Buffer is 900 bps (9%). Borrow 5% → healthy.
    client.set_pool_totals(&admin, &1_000, &50);

    let snap = client.pool_utilization_snapshot();
    assert!(snap.configured);
    assert_eq!(snap.utilization_bps, 500);
    assert_eq!(snap.liquidation_buffer_bps, 900);
    assert!(snap.healthy);
}

#[test]
fn test_pool_utilization_snapshot_unhealthy() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_client(&env);
    // Buffer is 900 bps (9%). Borrow 50% → unhealthy.
    client.set_pool_totals(&admin, &1_000, &500);

    let snap = client.pool_utilization_snapshot();
    assert!(!snap.healthy);
    assert_eq!(snap.utilization_bps, 5_000);
    assert_eq!(snap.available_liquidity, 500);
}

#[test]
fn test_pool_utilization_snapshot_no_totals() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_client(&env);

    let snap = client.pool_utilization_snapshot();
    assert!(snap.configured);
    assert_eq!(snap.total_supplied, 0);
    assert_eq!(snap.utilization_bps, 0);
    assert!(snap.healthy); // 0 utilization is always healthy
}

// ── interest_cooldown_accessor ───────────────────────────────────────────────

#[test]
fn test_interest_cooldown_accessor_ready_after_cooldown() {
    let env = Env::default();
    env.ledger().set_timestamp(10_000);
    env.mock_all_auths();
    let (client, _admin) = setup_client(&env);

    // last accrued at 9_500; cooldown=300 → expires at 9_800 < 10_000
    let acc = client.interest_cooldown_accessor(&9_500u64, &300u64);
    assert!(acc.ready);
    assert_eq!(acc.cooldown_expires_at, 9_800);
    assert_eq!(acc.now, 10_000);
}

#[test]
fn test_interest_cooldown_accessor_within_cooldown() {
    let env = Env::default();
    env.ledger().set_timestamp(10_000);
    env.mock_all_auths();
    let (client, _admin) = setup_client(&env);

    // last accrued at 9_800; cooldown=300 → expires at 10_100 > 10_000
    let acc = client.interest_cooldown_accessor(&9_800u64, &300u64);
    assert!(!acc.ready);
    assert_eq!(acc.cooldown_expires_at, 10_100);
}

#[test]
fn test_interest_cooldown_accessor_zero_cooldown_always_ready() {
    let env = Env::default();
    env.ledger().set_timestamp(100);
    env.mock_all_auths();
    let (client, _admin) = setup_client(&env);

    let acc = client.interest_cooldown_accessor(&99u64, &0u64);
    assert!(acc.ready);
}
