#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Env, Symbol};

#[test]
fn test_route_imbalance_summary() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);

    client.init(&admin);

    let route_id = Symbol::new(&env, "test_route");

    // Test empty state
    let summary = client.route_imbalance_summary(&route_id);
    assert_eq!(summary.total_allocated, 0);
    assert_eq!(summary.total_routed, 0);
    assert_eq!(summary.imbalance, 0);
    assert!(summary.is_balanced);

    // Update route
    client.update_route(&admin, &route_id, &1000);

    let summary = client.route_imbalance_summary(&route_id);
    assert_eq!(summary.total_allocated, 1000);
    assert_eq!(summary.total_routed, 0);
    assert_eq!(summary.imbalance, 1000);
    assert!(!summary.is_balanced);

    // Route some reward
    client.route_reward(&route_id, &400);

    let summary = client.route_imbalance_summary(&route_id);
    assert_eq!(summary.total_allocated, 1000);
    assert_eq!(summary.total_routed, 400);
    assert_eq!(summary.imbalance, 600);
    assert!(!summary.is_balanced);

    // Balance it
    client.route_reward(&route_id, &600);
    let summary = client.route_imbalance_summary(&route_id);
    assert_eq!(summary.imbalance, 0);
    assert!(summary.is_balanced);
}

#[test]
fn test_fallback_bucket() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);

    client.init(&admin);

    // Test missing fallback
    assert!(client.fallback_bucket().is_none());

    let bucket_addr = Address::generate(&env);
    client.set_fallback(&admin, &bucket_addr);

    let fallback = client.fallback_bucket().unwrap();
    assert_eq!(fallback.bucket_address, bucket_addr);
    assert_eq!(fallback.total_collected, 0);

    // Route to missing route (should go to fallback). The default test
    // ledger starts at sequence 0, so advance it to prove the fallback
    // records the ledger it was hit on.
    env.ledger().set_sequence_number(42);
    let missing_route = Symbol::new(&env, "missing");
    client.route_reward(&missing_route, &500);

    let fallback = client.fallback_bucket().unwrap();
    assert_eq!(fallback.total_collected, 500);
    assert!(fallback.last_fallback_ledger > 0);
    assert_eq!(fallback.last_fallback_ledger, 42);
}

#[test]
fn test_routing_state_snapshot_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);
    client.init(&admin);

    let snap = client.routing_state_snapshot();
    assert_eq!(snap.total_allocated, 0);
    assert_eq!(snap.total_routed, 0);
    assert_eq!(snap.total_imbalance, 0);
    assert_eq!(snap.split_ratio_bps, 0);
    assert_eq!(snap.fallback_collected, 0);
    assert!(!snap.has_fallback);
}

#[test]
fn test_routing_state_snapshot_with_routes() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);
    client.init(&admin);

    let r1 = Symbol::new(&env, "route_a");
    let r2 = Symbol::new(&env, "route_b");
    client.update_route(&admin, &r1, &1000);
    client.update_route(&admin, &r2, &500);
    client.route_reward(&r1, &400);

    let snap = client.routing_state_snapshot();
    assert_eq!(snap.total_allocated, 1500);
    assert_eq!(snap.total_routed, 400);
    assert_eq!(snap.total_imbalance, 1100);
    // 400 * 10_000 / 1500 = 2666
    assert_eq!(snap.split_ratio_bps, 2666);
    assert!(!snap.has_fallback);
}

#[test]
fn test_split_ratio_empty_route() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);
    client.init(&admin);

    let route_id = Symbol::new(&env, "new_route");
    assert_eq!(client.split_ratio(&route_id), 0);
}

#[test]
fn test_split_ratio_partial_routing() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RewardRouter, ());
    let client = RewardRouterClient::new(&env, &contract_id);
    client.init(&admin);

    let route_id = Symbol::new(&env, "my_route");
    client.update_route(&admin, &route_id, &1000);
    client.route_reward(&route_id, &500);
    // 500 * 10_000 / 1000 = 5000 bps (50%)
    assert_eq!(client.split_ratio(&route_id), 5000);
}
