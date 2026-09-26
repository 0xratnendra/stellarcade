#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env,
};

const PASS_COST: i128 = 100;
const DURATION_LEDGERS: u32 = 1_000;

fn setup(env: &Env) -> (SubscriptionPassClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(SubscriptionPass, ());
    let client = SubscriptionPassClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &token_address, &PASS_COST, &DURATION_LEDGERS);

    (client, admin, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. buying a pass activates membership for duration_ledgers
// ---------------------------------------------------------------------------

#[test]
fn test_buy_pass_activates_membership_for_duration() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);

    let pass = client.buy_pass(&player);

    assert_eq!(pass.expiry_ledger, 100 + DURATION_LEDGERS);
    assert!(client.is_pass_active(&player));
}

// ---------------------------------------------------------------------------
// 2. checking active pass after expiration returns false
// ---------------------------------------------------------------------------

#[test]
fn test_is_pass_active_false_after_expiration() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);
    client.buy_pass(&player);

    assert!(client.is_pass_active(&player));

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION_LEDGERS);
    assert!(!client.is_pass_active(&player));

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION_LEDGERS + 1);
    assert!(!client.is_pass_active(&player));
}

#[test]
fn test_is_pass_active_false_for_player_who_never_purchased() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    assert!(!client.is_pass_active(&player));
}

// ---------------------------------------------------------------------------
// 3. renewing a pass extends the expiry ledger correctly
// ---------------------------------------------------------------------------

#[test]
fn test_renew_pass_extends_expiry_from_current_expiry_when_still_active() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);
    let first = client.buy_pass(&player);
    assert_eq!(first.expiry_ledger, 100 + DURATION_LEDGERS);

    // Renew well before expiry: the new window should extend from the
    // existing expiry, not from "now", so unused time is preserved.
    env.ledger().with_mut(|l| l.sequence_number = 200);
    let renewed = client.renew_pass(&player);
    assert_eq!(
        renewed.expiry_ledger,
        first.expiry_ledger + DURATION_LEDGERS
    );
}

#[test]
fn test_renew_pass_extends_from_now_when_already_expired() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);
    let first = client.buy_pass(&player);

    // Let it lapse, then renew — the new window must not be backdated onto
    // the stale expiry.
    let now = first.expiry_ledger + 500;
    env.ledger().with_mut(|l| l.sequence_number = now);
    let renewed = client.renew_pass(&player);
    assert_eq!(renewed.expiry_ledger, now + DURATION_LEDGERS);
    assert!(client.is_pass_active(&player));
}

#[test]
fn test_renew_pass_without_existing_pass_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let result = client.try_renew_pass(&player);
    assert_eq!(result, Err(Ok(Error::NoActivePass)));
}

// ---------------------------------------------------------------------------
// VIP tier behavior
// ---------------------------------------------------------------------------

#[test]
fn test_admin_configured_tier_grants_bonus_duration_on_purchase() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);

    client.admin_configure_tier(&admin, &1, &500);
    client.admin_set_tier(&admin, &player, &1);

    let pass = client.buy_pass(&player);
    assert_eq!(pass.tier, 1);
    assert_eq!(pass.expiry_ledger, 100 + DURATION_LEDGERS + 500);
}

#[test]
fn test_admin_configured_tier_grants_bonus_duration_on_renewal() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 1_000);
    let first = client.buy_pass(&player);

    client.admin_configure_tier(&admin, &2, &750);
    client.admin_set_tier(&admin, &player, &2);

    env.ledger().with_mut(|l| l.sequence_number = 200);
    let renewed = client.renew_pass(&player);
    assert_eq!(
        renewed.expiry_ledger,
        first.expiry_ledger + DURATION_LEDGERS + 750
    );
}

#[test]
fn test_admin_set_tier_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let not_admin = Address::generate(&env);
    let player = Address::generate(&env);
    let result = client.try_admin_set_tier(&not_admin, &player, &1);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_admin_configure_tier_rejects_tier_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    let result = client.try_admin_configure_tier(&admin, &0, &500);
    assert_eq!(result, Err(Ok(Error::InvalidTier)));
}

// ---------------------------------------------------------------------------
// initialize / auth guards
// ---------------------------------------------------------------------------

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let result = client.try_initialize(&admin, &token_address, &PASS_COST, &DURATION_LEDGERS);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_rejects_zero_cost_or_duration() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(SubscriptionPass, ());
    let client = SubscriptionPassClient::new(&env, &contract_id);

    assert_eq!(
        client.try_initialize(&admin, &token_address, &0, &DURATION_LEDGERS),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(
        client.try_initialize(&admin, &token_address, &PASS_COST, &0),
        Err(Ok(Error::InvalidInput))
    );
}

#[test]
fn test_get_pass_details_without_purchase_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let player = Address::generate(&env);
    let result = client.try_get_pass_details(&player);
    assert_eq!(result, Err(Ok(Error::NoActivePass)));
}
