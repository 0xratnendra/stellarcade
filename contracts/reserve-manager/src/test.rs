#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

struct Setup {
    env: Env,
    client: ReserveManagerClient<'static>,
    admin: Address,
    treasury: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(ReserveManager, ());
    let client = ReserveManagerClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Safety: we transmute to 'static for easier use in test structure
    let client: ReserveManagerClient<'static> = unsafe { core::mem::transmute(client) };

    Setup {
        env,
        client,
        admin,
        treasury,
    }
}

#[test]
fn test_init_and_snapshot() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    let snapshot = s.client.get_full_snapshot();
    assert!(matches!(snapshot.config, OptionalManagerConfig::Some(_)));
    assert_eq!(snapshot.reserves.len(), 0);
    assert!(!s.client.is_paused());
}

#[test]
fn test_update_and_query_reserve() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    let asset = Address::generate(&s.env);
    s.client.update_reserve(&asset, &1000, &800);

    let state = s.client.get_reserve_for(&asset).unwrap();
    assert_eq!(state.balance, 1000);
    assert_eq!(state.status, ReserveStatus::Healthy);

    let snapshot = s.client.get_full_snapshot();
    assert_eq!(snapshot.reserves.len(), 1);
}

#[test]
fn test_reserve_status_thresholds() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    let asset_a = Address::generate(&s.env); // Healthy
    let asset_b = Address::generate(&s.env); // Below target
    let asset_c = Address::generate(&s.env); // Critical

    s.client.update_reserve(&asset_a, &1000, &1000);
    s.client.update_reserve(&asset_b, &600, &1000);
    s.client.update_reserve(&asset_c, &200, &1000);

    assert_eq!(
        s.client.get_reserve_for(&asset_a).unwrap().status,
        ReserveStatus::Healthy
    );
    assert_eq!(
        s.client.get_reserve_for(&asset_b).unwrap().status,
        ReserveStatus::BelowTarget
    );
    assert_eq!(
        s.client.get_reserve_for(&asset_c).unwrap().status,
        ReserveStatus::Critical
    );
}

#[test]
fn test_paused_blocks_updates() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    s.client.set_pause(&true);
    let asset = Address::generate(&s.env);
    let result = s.client.try_update_reserve(&asset, &100, &100);
    assert!(result.is_err());
}

#[test]
fn test_uninitialized_snapshot() {
    let env = Env::default();
    let contract_id = env.register(ReserveManager, ());
    let client = ReserveManagerClient::new(&env, &contract_id);

    let snapshot = client.get_full_snapshot();
    assert_eq!(snapshot.config, OptionalManagerConfig::None);
    assert_eq!(snapshot.reserves.len(), 0);
}

#[test]
fn test_sweep_cooldown_returns_constant() {
    let s = setup();
    assert_eq!(s.client.sweep_cooldown_ledgers(), 2_880u32);
}

#[test]
fn test_manager_threshold_summary_empty() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    let summary = s.client.manager_threshold_summary();
    assert_eq!(summary.total_assets, 0);
    assert_eq!(summary.healthy_count, 0);
    assert_eq!(summary.below_target_count, 0);
    assert_eq!(summary.critical_count, 0);
    assert_eq!(summary.at_or_above_threshold_count, 0);
    assert_eq!(summary.sweep_cooldown_ledgers, 2_880u32);
    assert!(!summary.is_paused);
}

#[test]
fn test_manager_threshold_summary_counts() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);

    let healthy = Address::generate(&s.env);
    let below = Address::generate(&s.env);
    let critical = Address::generate(&s.env);

    s.client.update_reserve(&healthy, &1000, &1000); // Healthy
    s.client.update_reserve(&below, &600, &1000); // BelowTarget
    s.client.update_reserve(&critical, &200, &1000); // Critical

    let summary = s.client.manager_threshold_summary();
    assert_eq!(summary.total_assets, 3);
    assert_eq!(summary.healthy_count, 1);
    assert_eq!(summary.below_target_count, 1);
    assert_eq!(summary.critical_count, 1);
    assert_eq!(summary.at_or_above_threshold_count, 1);
    assert!(!summary.is_paused);
}

#[test]
fn test_manager_threshold_summary_paused() {
    let s = setup();
    s.client.init(&s.admin, &s.treasury);
    s.client.set_pause(&true);

    let summary = s.client.manager_threshold_summary();
    assert!(summary.is_paused);
}
