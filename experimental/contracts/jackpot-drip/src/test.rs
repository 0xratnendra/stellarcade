#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::{JackpotDrip, JackpotDripClient};
use crate::types::{Error, SWEEP_TIMELOCK_LEDGERS};

const DRIP_RATE: i128 = 1_000; // tokens per ledger
const VOLUME: i128 = 100_000;

struct Setup {
    env: Env,
    client: JackpotDripClient<'static>,
    contract_id: Address,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(JackpotDrip, ());
    let client = JackpotDripClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address(), &DRIP_RATE);

    Setup {
        token: token::Client::new(&env, &sac.address()),
        token_admin: token::StellarAssetClient::new(&env, &sac.address()),
        env,
        client,
        contract_id,
        admin,
    }
}

#[test]
fn test_funding_drip_pool_increases_available_balance() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &50_000);

    assert_eq!(s.client.get_pool_balance(), 0);
    s.client.fund_drip_pool(&funder, &50_000);
    assert_eq!(s.client.get_pool_balance(), 50_000);
    assert_eq!(s.token.balance(&s.contract_id), 50_000);
}

#[test]
fn test_player_claims_proportional_share_of_elapsed_ledgers() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &1_000_000);
    s.client.fund_drip_pool(&funder, &1_000_000);

    let alice = Address::generate(&s.env);
    let bob = Address::generate(&s.env);

    // Equal activity: both hold 50% weight.
    s.client.record_player_activity(&alice, &VOLUME);
    s.client.record_player_activity(&bob, &VOLUME);

    // Advance 10 ledgers: 10 × 1000 = 10,000 dripped; each is owed 5,000.
    s.env.ledger().with_mut(|l| {
        l.sequence_number += 10;
    });

    let alice_claim = s.client.claim_drip(&alice);
    assert_eq!(alice_claim, 5_000, "50% of 10 ledgers × 1000/ledger");
    assert_eq!(s.token.balance(&alice), 5_000);

    // Watermark advanced to Alice's claim ledger: her re-claim is zero…
    assert_eq!(s.client.claim_drip(&alice), 0);

    // …and Bob's claim covers the remaining elapsed window: 5,000.
    let bob_claim = s.client.claim_drip(&bob);
    assert_eq!(bob_claim, 5_000);
    assert_eq!(s.token.balance(&bob), 5_000);
}

#[test]
fn test_higher_volume_gets_larger_share() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &1_000_000);
    s.client.fund_drip_pool(&funder, &1_000_000);

    let whale = Address::generate(&s.env);
    let minnow = Address::generate(&s.env);
    s.client.record_player_activity(&whale, &(VOLUME * 3));
    s.client.record_player_activity(&minnow, &VOLUME);

    s.env.ledger().with_mut(|l| {
        l.sequence_number += 8;
    });

    let whale_claim = s.client.claim_drip(&whale);
    let minnow_claim = s.client.claim_drip(&minnow);
    assert_eq!(whale_claim, 6_000); // 3/4 of 8 × 1000
    assert_eq!(minnow_claim, 2_000); // 1/4 of 8 × 1000
}

#[test]
fn test_zero_activity_claims_return_zero_tokens() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &1_000_000);
    s.client.fund_drip_pool(&funder, &1_000_000);

    let idle = Address::generate(&s.env);
    s.env.ledger().with_mut(|l| {
        l.sequence_number += 10;
    });

    // No recorded activity — claim returns exactly zero tokens.
    assert_eq!(s.client.claim_drip(&idle), 0);
    assert_eq!(s.token.balance(&idle), 0);
}

#[test]
fn test_claim_capped_at_pool_balance() {
    let s = setup();
    let funder = Address::generate(&s.env);
    // Pool holds far less than the accrued drip.
    s.token_admin.mint(&funder, &3_000);
    s.client.fund_drip_pool(&funder, &3_000);

    let alice = Address::generate(&s.env);
    s.client.record_player_activity(&alice, &VOLUME);

    s.env.ledger().with_mut(|l| {
        l.sequence_number += 50;
    });
    // 50 × 1000 = 50,000 owed but only 3,000 in the pool.
    let claim = s.client.claim_drip(&alice);
    assert_eq!(claim, 3_000);
    assert_eq!(s.client.get_pool_balance(), 0);
    assert_eq!(s.token.balance(&s.contract_id), 0);
}

#[test]
fn test_record_activity_rejects_non_positive_volume() {
    let s = setup();
    let player = Address::generate(&s.env);
    let result = s.client.try_record_player_activity(&player, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_funding_rejects_zero_amount() {
    let s = setup();
    let funder = Address::generate(&s.env);
    let result = s.client.try_fund_drip_pool(&funder, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_initialize_rejects_zero_drip_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(JackpotDrip, ());
    let client = JackpotDripClient::new(&env, &contract_id);
    let result = client.try_initialize(&admin, &sac.address(), &0);
    assert_eq!(result, Err(Ok(Error::InvalidDripRate)));
}

#[test]
fn test_emergency_sweep_blocked_by_timelock_then_executes() {
    let s = setup();
    let funder = Address::generate(&s.env);
    s.token_admin.mint(&funder, &7_000);
    s.client.fund_drip_pool(&funder, &7_000);

    let recipient = Address::generate(&s.env);
    s.client.request_emergency_sweep(&s.admin, &recipient);

    // Too early: timelock still active.
    let result = s.client.try_execute_emergency_sweep(&s.admin);
    assert_eq!(result, Err(Ok(Error::SweepTimelockActive)));

    s.env.ledger().with_mut(|l| {
        l.sequence_number += SWEEP_TIMELOCK_LEDGERS;
    });
    let swept = s.client.execute_emergency_sweep(&s.admin);
    assert_eq!(swept, 7_000);
    assert_eq!(s.client.get_pool_balance(), 0);
    assert_eq!(s.token.balance(&recipient), 7_000);
}

#[test]
fn test_emergency_sweep_rejects_non_admin_and_unrequested() {
    let s = setup();
    let impostor = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);

    // Non-admin cannot request or execute.
    let result = s.client.try_request_emergency_sweep(&impostor, &recipient);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    let result = s.client.try_execute_emergency_sweep(&impostor);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));

    // Executing with no pending request fails explicitly.
    let result = s.client.try_execute_emergency_sweep(&s.admin);
    assert_eq!(result, Err(Ok(Error::SweepNotRequested)));
}

#[test]
fn test_initialize_twice_fails() {
    let s = setup();
    let result = s.client.try_initialize(&s.admin, &s.token.address, &DRIP_RATE);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
