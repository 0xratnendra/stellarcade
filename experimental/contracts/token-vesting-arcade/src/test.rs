#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env};

const START: u64 = 1_000;

fn setup() -> (Env, TokenVestingArcadeContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = START);
    let contract_id = env.register(TokenVestingArcadeContract, ());
    let client = TokenVestingArcadeContractClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_claim_is_zero_before_cliff() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let id = client.create_schedule(&admin, &beneficiary, &1000u128, &START, &100, &1000, &false);

    env.ledger().with_mut(|l| l.timestamp = START + 50); // before cliff
    let claimed = client.claim(&id, &beneficiary);
    assert_eq!(claimed, 0);

    let summary = client.get_schedule_status(&id);
    assert_eq!(summary.vested_amount, 0);
    assert_eq!(summary.locked_amount, 1000);
}

#[test]
fn test_linear_vesting_unlocks_half_at_midpoint() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let id = client.create_schedule(&admin, &beneficiary, &1000u128, &START, &0, &1000, &false);

    env.ledger().with_mut(|l| l.timestamp = START + 500); // 50% through
    let claimed = client.claim(&id, &beneficiary);
    assert_eq!(claimed, 500);

    // Fully vests by the end; a second claim pays the remainder.
    env.ledger().with_mut(|l| l.timestamp = START + 1000);
    let claimed2 = client.claim(&id, &beneficiary);
    assert_eq!(claimed2, 500);

    let summary = client.get_schedule_status(&id);
    assert_eq!(summary.claimed_amount, 1000);
    assert_eq!(summary.locked_amount, 0);
}

#[test]
fn test_revoke_returns_unvested_tokens_to_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let id = client.create_schedule(&admin, &beneficiary, &1000u128, &START, &0, &1000, &true);

    env.ledger().with_mut(|l| l.timestamp = START + 300); // 30% vested
    let clawback = client.revoke(&admin, &id);
    assert_eq!(clawback, 700);

    // The beneficiary can still claim what had already vested at revocation.
    let claimed = client.claim(&id, &beneficiary);
    assert_eq!(claimed, 300);

    let summary = client.get_schedule_status(&id);
    assert!(summary.revoked);
    assert_eq!(summary.locked_amount, 0);
}

#[test]
#[should_panic(expected = "schedule is not revocable")]
fn test_revoke_rejects_non_revocable_schedule() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let id = client.create_schedule(&admin, &beneficiary, &1000u128, &START, &0, &1000, &false);
    client.revoke(&admin, &id);
}
