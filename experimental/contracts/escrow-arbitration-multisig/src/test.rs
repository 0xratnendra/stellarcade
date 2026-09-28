#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, vec, Address, Env};

const WAGER: i128 = 100_0000000;

fn setup(
    env: &Env,
) -> (
    EscrowArbitrationMultisigClient<'_>,
    Address,
    Address,
    Vec<Address>,
    Address,
) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(EscrowArbitrationMultisig, ());
    let client = EscrowArbitrationMultisigClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&token_address);

    let p1 = Address::generate(env);
    let p2 = Address::generate(env);
    let arbiters = vec![
        env,
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    ];

    mint(env, &token_address, &p1, 10_000_000_000);
    mint(env, &token_address, &p2, 10_000_000_000);

    (client, p1, p2, arbiters, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. dispute creation locks wager
// ---------------------------------------------------------------------------

#[test]
fn test_dispute_creation_locks_wager_from_both_players() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, token_address) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&p1), 10_000_000_000 - WAGER);
    assert_eq!(token_client.balance(&p2), 10_000_000_000 - WAGER);
    assert_eq!(token_client.balance(&client.address), WAGER * 2);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.wager, WAGER);
    assert!(!dispute.settled);
}

#[test]
fn test_create_dispute_rejects_non_three_arbiters() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, _arbiters, _token) = setup(&env);

    let two_arbiters = vec![&env, Address::generate(&env), Address::generate(&env)];
    let result = client.try_create_dispute(&p1, &p2, &WAGER, &two_arbiters);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_create_dispute_rejects_player_as_arbiter() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, _arbiters, _token) = setup(&env);

    let arbiters_with_player = vec![
        &env,
        p1.clone(),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let result = client.try_create_dispute(&p1, &p2, &WAGER, &arbiters_with_player);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

// ---------------------------------------------------------------------------
// 2. reaching 2 matching arbiter votes triggers execution
// ---------------------------------------------------------------------------

#[test]
fn test_two_matching_votes_trigger_execution_and_pay_winner() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, token_address) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let arbiter_0 = arbiters.get(0).unwrap();
    let arbiter_1 = arbiters.get(1).unwrap();

    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p1.clone()));
    client.cast_vote(&arbiter_1, &dispute_id, &Ruling::Winner(p1.clone()));

    client.execute_ruling(&dispute_id);

    let dispute = client.get_dispute(&dispute_id);
    assert!(dispute.settled);

    let total_pool = WAGER * 2;
    let fee = total_pool * 200 / 10_000;
    let distributable = total_pool - fee;

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(
        token_client.balance(&p1),
        10_000_000_000 - WAGER + distributable
    );
    assert_eq!(token_client.balance(&p2), 10_000_000_000 - WAGER);
}

#[test]
fn test_split_ruling_pays_both_players_and_conserves_total_value() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, token_address) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let arbiter_0 = arbiters.get(0).unwrap();
    let arbiter_2 = arbiters.get(2).unwrap();

    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Split);
    client.cast_vote(&arbiter_2, &dispute_id, &Ruling::Split);

    client.execute_ruling(&dispute_id);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    let total_pool = WAGER * 2;
    let fee = total_pool * 200 / 10_000;
    let distributable = total_pool - fee;

    let p1_balance = token_client.balance(&p1);
    let p2_balance = token_client.balance(&p2);
    // Total value conserved: what both players + all 3 arbiters received
    // sums to exactly the original 2 * WAGER pool.
    let arbiter_total: i128 = (0..arbiters.len())
        .map(|i| token_client.balance(&arbiters.get(i).unwrap()))
        .sum();
    assert_eq!(
        (p1_balance - (10_000_000_000 - WAGER))
            + (p2_balance - (10_000_000_000 - WAGER))
            + arbiter_total,
        total_pool
    );
    assert_eq!(
        (p1_balance - (10_000_000_000 - WAGER)) + (p2_balance - (10_000_000_000 - WAGER)),
        distributable
    );
}

#[test]
fn test_no_consensus_yet_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, _token) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let arbiter_0 = arbiters.get(0).unwrap();
    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p1.clone()));

    let result = client.try_execute_ruling(&dispute_id);
    assert_eq!(result, Err(Ok(Error::NoRulingConsensusYet)));
}

#[test]
fn test_disagreeing_votes_do_not_trigger_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, _token) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let arbiter_0 = arbiters.get(0).unwrap();
    let arbiter_1 = arbiters.get(1).unwrap();
    let arbiter_2 = arbiters.get(2).unwrap();

    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p1.clone()));
    client.cast_vote(&arbiter_1, &dispute_id, &Ruling::Winner(p2.clone()));
    client.cast_vote(&arbiter_2, &dispute_id, &Ruling::Split);

    let result = client.try_execute_ruling(&dispute_id);
    assert_eq!(result, Err(Ok(Error::NoRulingConsensusYet)));
}

// ---------------------------------------------------------------------------
// 3. unauthorized address cannot cast arbiter vote
// ---------------------------------------------------------------------------

#[test]
fn test_unauthorized_address_cannot_cast_arbiter_vote() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, _token) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);

    let outsider = Address::generate(&env);
    let result = client.try_cast_vote(&outsider, &dispute_id, &Ruling::Winner(p1.clone()));
    assert_eq!(result, Err(Ok(Error::NotARegisteredArbiter)));
}

#[test]
fn test_arbiter_cannot_vote_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, _token) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);
    let arbiter_0 = arbiters.get(0).unwrap();

    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p1.clone()));
    let result = client.try_cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p2.clone()));
    assert_eq!(result, Err(Ok(Error::ArbiterAlreadyVoted)));
}

#[test]
fn test_cannot_vote_on_settled_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, p1, p2, arbiters, _token) = setup(&env);

    let dispute_id = client.create_dispute(&p1, &p2, &WAGER, &arbiters);
    let arbiter_0 = arbiters.get(0).unwrap();
    let arbiter_1 = arbiters.get(1).unwrap();
    let arbiter_2 = arbiters.get(2).unwrap();

    client.cast_vote(&arbiter_0, &dispute_id, &Ruling::Winner(p1.clone()));
    client.cast_vote(&arbiter_1, &dispute_id, &Ruling::Winner(p1.clone()));
    client.execute_ruling(&dispute_id);

    let result = client.try_cast_vote(&arbiter_2, &dispute_id, &Ruling::Winner(p1.clone()));
    assert_eq!(result, Err(Ok(Error::DisputeAlreadySettled)));
}
