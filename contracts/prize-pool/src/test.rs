#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    testutils::Ledger,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

// ------------------------------------------------------------------
// Test helpers
// ------------------------------------------------------------------

/// Deploy a fresh token contract and return its address plus an admin client
/// for minting. The token admin is separate from the prize pool admin so
/// tests can mint independently of prize pool auth.
fn create_token<'a>(env: &'a Env, token_admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_client = StellarAssetClient::new(env, &token_contract.address());
    (token_contract.address(), token_client)
}

/// Register a PrizePool contract, initialize it, and return the client plus
/// supporting addresses. Tokens are pre-minted to `funder` for convenience.
fn setup(
    env: &Env,
) -> (
    PrizePoolClient<'_>,
    Address, // admin
    Address, // funder
    Address, // token address
) {
    let admin = Address::generate(env);
    let funder = Address::generate(env);
    let token_admin = Address::generate(env);

    let (token_addr, token_sac) = create_token(env, &token_admin);

    let contract_id = env.register(PrizePool, ());
    let client = PrizePoolClient::new(env, &contract_id);

    env.mock_all_auths();
    client.init(&admin, &token_addr);

    // Give the funder a starting balance to work with.
    token_sac.mint(&funder, &10_000i128);

    (client, admin, funder, token_addr)
}

/// Return a `TokenClient` for balance assertions.
fn token_client<'a>(env: &'a Env, token: &Address) -> TokenClient<'a> {
    TokenClient::new(env, token)
}

// ------------------------------------------------------------------
// 1. Initialize contract once; reject re-init
// ------------------------------------------------------------------

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let (client, admin, _, token_addr) = setup(&env);
    env.mock_all_auths();

    let result = client.try_init(&admin, &token_addr);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 2. Fund pool and verify balance update
// ------------------------------------------------------------------

#[test]
fn test_fund_increases_available() {
    let env = Env::default();
    let (client, _, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);

    let state = client.get_pool_state();
    assert_eq!(state.available, 1_000);
    assert_eq!(state.reserved, 0);
}

#[test]
fn test_fund_zero_rejected() {
    let env = Env::default();
    let (client, _, funder, _) = setup(&env);
    env.mock_all_auths();

    let result = client.try_fund(&funder, &0i128);
    assert!(result.is_err());
}

#[test]
fn test_fund_negative_rejected() {
    let env = Env::default();
    let (client, _, funder, _) = setup(&env);
    env.mock_all_auths();

    let result = client.try_fund(&funder, &-1i128);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 3. Reserve path updates state correctly
// ------------------------------------------------------------------

#[test]
fn test_reserve_moves_available_to_reserved() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &600i128);

    let state = client.get_pool_state();
    assert_eq!(state.available, 400);
    assert_eq!(state.reserved, 600);
}

#[test]
fn test_reserve_same_game_id_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &42u64, &100i128);

    let result = client.try_reserve(&admin, &42u64, &100i128);
    assert!(result.is_err());
}

#[test]
fn test_reserve_exceeding_available_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &500i128);

    let result = client.try_reserve(&admin, &1u64, &501i128);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 4. Release path updates state correctly
// ------------------------------------------------------------------

#[test]
fn test_release_returns_funds_to_available() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &600i128);
    client.release(&admin, &1u64, &600i128);

    let state = client.get_pool_state();
    assert_eq!(state.available, 1_000);
    assert_eq!(state.reserved, 0);
}

#[test]
fn test_partial_release_leaves_reservation() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &600i128);
    client.release(&admin, &1u64, &200i128); // return 200, leave 400 reserved

    let state = client.get_pool_state();
    assert_eq!(state.available, 600); // 400 original + 200 released
    assert_eq!(state.reserved, 400); // 600 - 200
}

#[test]
fn test_release_nonexistent_reservation_rejected() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    env.mock_all_auths();

    let result = client.try_release(&admin, &99u64, &100i128);
    assert!(result.is_err());
}

#[test]
fn test_release_exceeding_remaining_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &500i128);

    let result = client.try_release(&admin, &1u64, &501i128);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 5. Reject payout above reservation
// ------------------------------------------------------------------

#[test]
fn test_payout_exceeding_reservation_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &300i128);

    let winner = Address::generate(&env);
    let result = client.try_payout(&admin, &winner, &1u64, &301i128);
    assert!(result.is_err());
}

#[test]
fn test_payout_nonexistent_reservation_rejected() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    env.mock_all_auths();

    let winner = Address::generate(&env);
    let result = client.try_payout(&admin, &winner, &99u64, &100i128);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 6. Happy-path payout transfers tokens and updates state
// ------------------------------------------------------------------

#[test]
fn test_payout_transfers_tokens_to_winner() {
    let env = Env::default();
    let (client, admin, funder, token_addr) = setup(&env);
    env.mock_all_auths();

    let winner = Address::generate(&env);
    let tc = token_client(&env, &token_addr);

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &500i128);
    client.payout(&admin, &winner, &1u64, &500i128);

    // Tokens must have moved to the winner.
    assert_eq!(tc.balance(&winner), 500);

    // Reservation is fully consumed; state reflects the debit.
    let state = client.get_pool_state();
    assert_eq!(state.available, 500);
    assert_eq!(state.reserved, 0);
}

#[test]
fn test_multiple_partial_payouts_same_game() {
    let env = Env::default();
    let (client, admin, funder, token_addr) = setup(&env);
    env.mock_all_auths();

    let winner1 = Address::generate(&env);
    let winner2 = Address::generate(&env);
    let tc = token_client(&env, &token_addr);

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &7u64, &600i128);

    // Two winners each receive 300 from the same reservation.
    client.payout(&admin, &winner1, &7u64, &300i128);
    client.payout(&admin, &winner2, &7u64, &300i128);

    assert_eq!(tc.balance(&winner1), 300);
    assert_eq!(tc.balance(&winner2), 300);

    let state = client.get_pool_state();
    assert_eq!(state.available, 400);
    assert_eq!(state.reserved, 0);
}

// ------------------------------------------------------------------
// 7. Unauthorized caller paths fail
// ------------------------------------------------------------------

#[test]
fn test_reserve_by_non_admin_rejected() {
    let env = Env::default();
    let (client, _, funder, _) = setup(&env);
    env.mock_all_auths();

    // funder is not admin
    client.fund(&funder, &1_000i128);
    let result = client.try_reserve(&funder, &1u64, &100i128);
    assert!(result.is_err());
}

#[test]
fn test_payout_by_non_admin_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &500i128);

    let winner = Address::generate(&env);
    // funder tries to payout — not admin
    let result = client.try_payout(&funder, &winner, &1u64, &500i128);
    assert!(result.is_err());
}

#[test]
fn test_release_by_non_admin_rejected() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &1u64, &500i128);

    let result = client.try_release(&funder, &1u64, &500i128);
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 8. get_pool_state requires initialization
// ------------------------------------------------------------------

#[test]
fn test_get_pool_state_before_init_rejected() {
    let env = Env::default();
    let contract_id = env.register(PrizePool, ());
    let client = PrizePoolClient::new(&env, &contract_id);

    let result = client.try_get_pool_state();
    assert!(result.is_err());
}

// ------------------------------------------------------------------
// 9. Full lifecycle: fund → reserve → partial payout → release remainder
// ------------------------------------------------------------------

#[test]
fn test_full_lifecycle() {
    let env = Env::default();
    let (client, admin, funder, token_addr) = setup(&env);
    env.mock_all_auths();

    let winner = Address::generate(&env);
    let tc = token_client(&env, &token_addr);

    client.fund(&funder, &2_000i128);

    // Two games; game 1 has a winner, game 2 is cancelled.
    client.reserve(&admin, &1u64, &1_000i128);
    client.reserve(&admin, &2u64, &1_000i128);

    // Game 1: single winner takes the pot.
    client.payout(&admin, &winner, &1u64, &1_000i128);

    // Game 2: cancelled, all funds returned.
    client.release(&admin, &2u64, &1_000i128);

    assert_eq!(tc.balance(&winner), 1_000);

    // Pool should be back to 1_000 available (released game 2 funds).
    let state = client.get_pool_state();
    assert_eq!(state.available, 1_000);
    assert_eq!(state.reserved, 0);
}

// ------------------------------------------------------------------
// 10. Prize Pool Metrics tests
// ------------------------------------------------------------------

#[test]
fn test_metrics_uninitialized_rejected() {
    let env = Env::default();
    let contract_id = env.register(PrizePool, ());
    let client = PrizePoolClient::new(&env, &contract_id);

    let result = client.try_get_prize_pool_metrics();
    assert!(result.is_err());
}

#[test]
fn test_metrics_initial_state() {
    let env = Env::default();
    let (client, _, _, _) = setup(&env);

    let metrics = client.get_prize_pool_metrics();
    assert_eq!(metrics.available_balance, 0);
    assert_eq!(metrics.reserved_amount, 0);
    assert_eq!(metrics.payouts_count, 0);
    assert_eq!(metrics.last_update_ledger, env.ledger().sequence());
}

#[test]
fn test_metrics_after_fund() {
    let env = Env::default();
    let (client, _, funder, _) = setup(&env);
    env.mock_all_auths();

    env.ledger().set_sequence_number(100);
    client.fund(&funder, &1_000i128);

    let metrics = client.get_prize_pool_metrics();
    assert_eq!(metrics.available_balance, 1_000);
    assert_eq!(metrics.last_update_ledger, 100);
}

#[test]
fn test_metrics_after_reserve_release_payout() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &5_000i128);

    // Reserve
    env.ledger().set_sequence_number(200);
    client.reserve(&admin, &1u64, &2_000i128);
    let m1 = client.get_prize_pool_metrics();
    assert_eq!(m1.available_balance, 3_000);
    assert_eq!(m1.reserved_amount, 2_000);
    assert_eq!(m1.last_update_ledger, 200);

    // Payout
    env.ledger().set_sequence_number(300);
    let winner = Address::generate(&env);
    client.payout(&admin, &winner, &1u64, &500i128);
    let m2 = client.get_prize_pool_metrics();
    assert_eq!(m2.reserved_amount, 1_500);
    assert_eq!(m2.payouts_count, 1);
    assert_eq!(m2.last_update_ledger, 300);

    // Release
    env.ledger().set_sequence_number(400);
    client.release(&admin, &1u64, &500i128);
    let m3 = client.get_prize_pool_metrics();
    assert_eq!(m3.available_balance, 3_500);
    assert_eq!(m3.reserved_amount, 1_000);
    assert_eq!(m3.last_update_ledger, 400);
}

#[test]
fn test_rotate_admin_success() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    env.mock_all_auths();

    let new_admin = Address::generate(&env);
    client.rotate_admin(&admin, &new_admin);

    let snapshot = client.get_config_snapshot();
    assert_eq!(snapshot.admin, new_admin);
}

#[test]
fn test_rotate_admin_unauthorized_rejected() {
    let env = Env::default();
    let (client, _, _, _) = setup(&env);
    env.mock_all_auths();

    let attacker = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let result = client.try_rotate_admin(&attacker, &new_admin);
    assert!(result.is_err());
}

#[test]
fn test_config_snapshot_accuracy() {
    let env = Env::default();
    let (client, admin, funder, token_addr) = setup(&env);
    env.mock_all_auths();

    env.ledger().set_sequence_number(55);
    client.fund(&funder, &1_500i128);
    client.reserve(&admin, &9u64, &500i128);

    let snapshot = client.get_config_snapshot();
    assert_eq!(snapshot.admin, admin);
    assert_eq!(snapshot.token, token_addr);
    assert_eq!(snapshot.available_balance, 1_000);
    assert_eq!(snapshot.reserved_amount, 500);
    assert_eq!(snapshot.payouts_count, 0);
    assert_eq!(snapshot.last_update_ledger, 55);
}

#[test]
fn test_prize_allocation_summary_happy_path() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &2_000i128);
    client.reserve(&admin, &11u64, &1_200i128);
    client.release(&admin, &11u64, &200i128);

    let summary = client.get_prize_allocation_summary(&11u64);
    assert!(summary.exists);
    assert_eq!(summary.total_allocated, 1_200);
    assert_eq!(summary.amount_distributed, 200);
    assert_eq!(summary.remaining_amount, 1_000);
    assert!(!summary.fully_distributed);
}

#[test]
fn test_prize_allocation_summary_missing_game_is_predictable() {
    let env = Env::default();
    let (client, _, _, _) = setup(&env);

    let summary = client.get_prize_allocation_summary(&404u64);
    assert!(!summary.exists);
    assert_eq!(summary.total_allocated, 0);
    assert_eq!(summary.remaining_amount, 0);
    assert!(summary.fully_distributed);
}

#[test]
fn test_claim_pressure_empty_pool_returns_zero_ratio() {
    let env = Env::default();
    let (client, _, _, _) = setup(&env);

    let pressure = client.get_claim_pressure();
    assert_eq!(pressure.available_balance, 0);
    assert_eq!(pressure.reserved_amount, 0);
    assert_eq!(pressure.tracked_balance, 0);
    assert_eq!(pressure.reserved_share_bps, 0);
}

#[test]
fn test_claim_pressure_tracks_reserved_share() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();

    client.fund(&funder, &1_000i128);
    client.reserve(&admin, &5u64, &250i128);

    let pressure = client.get_claim_pressure();
    assert_eq!(pressure.available_balance, 750);
    assert_eq!(pressure.reserved_amount, 250);
    assert_eq!(pressure.tracked_balance, 1_000);
    assert_eq!(pressure.reserved_share_bps, 2_500);
}

// ------------------------------------------------------------------
// Instance storage TTL (#1385)
// ------------------------------------------------------------------

fn instance_ttl(env: &Env, contract_id: &Address) -> u32 {
    use soroban_sdk::testutils::storage::Instance as _;
    env.as_contract(contract_id, || env.storage().instance().get_ttl())
}

fn advance_ledgers(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|l| l.sequence_number += ledgers);
}

/// Ledgers to advance so the instance TTL drops below the extension threshold
/// while the persistent entries written by earlier calls stay alive.
const DECAY: u32 = INSTANCE_BUMP_LEDGERS - INSTANCE_LIFETIME_THRESHOLD + 1_000;

#[test]
fn test_init_extends_instance_ttl() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_addr, _) = create_token(&env, &token_admin);
    let contract_id = env.register(PrizePool, ());
    let client = PrizePoolClient::new(&env, &contract_id);
    env.mock_all_auths();

    assert!(instance_ttl(&env, &contract_id) < INSTANCE_BUMP_LEDGERS);
    client.init(&admin, &token_addr);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);
}

#[test]
fn test_state_changing_calls_extend_instance_ttl() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();
    let contract_id = client.address.clone();
    let winner = Address::generate(&env);

    // fund
    advance_ledgers(&env, DECAY);
    assert!(instance_ttl(&env, &contract_id) < INSTANCE_LIFETIME_THRESHOLD);
    client.fund(&funder, &5_000i128);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

    // reserve
    advance_ledgers(&env, DECAY);
    client.reserve(&admin, &1u64, &2_000i128);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

    // payout
    advance_ledgers(&env, DECAY);
    client.payout(&admin, &winner, &1u64, &500i128);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

    // release
    advance_ledgers(&env, DECAY);
    client.release(&admin, &1u64, &500i128);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

    // sync
    advance_ledgers(&env, DECAY);
    client.sync(&admin);
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

    // rotate_admin
    advance_ledgers(&env, DECAY);
    client.rotate_admin(&admin, &Address::generate(&env));
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);
}

#[test]
fn test_contract_still_works_after_original_instance_ttl_passed() {
    let env = Env::default();
    let (client, admin, funder, _) = setup(&env);
    env.mock_all_auths();
    let contract_id = client.address.clone();
    let winner = Address::generate(&env);

    // TTL granted by setup's `init`; each call renews it.
    let original_ttl = instance_ttl(&env, &contract_id);

    // Step past the original expiry in two hops, with state-changing calls in
    // between that renew the instance and the persistent accounting entries.
    advance_ledgers(&env, original_ttl / 2 + 1_000);
    client.fund(&funder, &5_000i128);
    client.reserve(&admin, &1u64, &1_000i128);
    advance_ledgers(&env, original_ttl / 2 + 1_000);

    client.payout(&admin, &winner, &1u64, &400i128);
    assert_eq!(
        token_client(&env, &client.get_config_snapshot().token).balance(&winner),
        400
    );
    assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);
}
