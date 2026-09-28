#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String,
};

use crate::types::Error;
use crate::{PredictionPerpetual, PredictionPerpetualClient};

const END_OFFSET: u64 = 1_000;

struct Setup {
    env: Env,
    client: PredictionPerpetualClient<'static>,
    token: token::Client<'static>,
    oracle: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000_000);

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(PredictionPerpetual, ());
    let client = PredictionPerpetualClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address());

    Setup {
        token: token::Client::new(&env, &sac.address()),
        env,
        client,
        oracle,
    }
}

fn fund(s: &Setup, addr: &Address, amount: i128) {
    token::StellarAssetClient::new(&s.env, &s.token.address).mint(addr, &amount);
}

fn question(env: &Env) -> String {
    String::from_str(env, "Will Player A defeat Player B?")
}

#[test]
fn test_place_bet_updates_pools_and_odds() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let yes_bettor = Address::generate(&s.env);
    let no_bettor = Address::generate(&s.env);
    fund(&s, &yes_bettor, 300);
    fund(&s, &no_bettor, 100);

    s.client.place_bet(&yes_bettor, &market_id, &true, &300);
    s.client.place_bet(&no_bettor, &market_id, &false, &100);

    let market = s.client.get_market(&market_id);
    assert_eq!(market.yes_pool, 300);
    assert_eq!(market.no_pool, 100);

    let (yes_bps, no_bps) = s.client.get_implied_odds(&market_id);
    assert_eq!(yes_bps, 7_500);
    assert_eq!(no_bps, 2_500);
}

#[test]
fn test_implied_odds_default_before_any_bets() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let (yes_bps, no_bps) = s.client.get_implied_odds(&market_id);
    assert_eq!(yes_bps, 5_000);
    assert_eq!(no_bps, 5_000);
}

#[test]
fn test_claim_proportional_payout_sums_to_pool() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let yes_bettor_a = Address::generate(&s.env);
    let yes_bettor_b = Address::generate(&s.env);
    let no_bettor = Address::generate(&s.env);
    fund(&s, &yes_bettor_a, 300);
    fund(&s, &yes_bettor_b, 100);
    fund(&s, &no_bettor, 200);

    s.client.place_bet(&yes_bettor_a, &market_id, &true, &300);
    s.client.place_bet(&yes_bettor_b, &market_id, &true, &100);
    s.client.place_bet(&no_bettor, &market_id, &false, &200);

    s.env.ledger().with_mut(|l| l.timestamp = end_time + 1);
    s.client.resolve(&s.oracle, &market_id, &true);

    let payout_a = s.client.claim(&yes_bettor_a, &market_id);
    let payout_b = s.client.claim(&yes_bettor_b, &market_id);

    // Total pool is 600; winners split it pro-rata to their YES stake.
    assert_eq!(payout_a, 450);
    assert_eq!(payout_b, 150);
    assert_eq!(payout_a + payout_b, 600);
    assert_eq!(s.token.balance(&yes_bettor_a), 450);
    assert_eq!(s.token.balance(&yes_bettor_b), 150);
}

#[test]
fn test_non_oracle_cannot_resolve() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    s.env.ledger().with_mut(|l| l.timestamp = end_time + 1);
    let impostor = Address::generate(&s.env);
    let err = s
        .client
        .try_resolve(&impostor, &market_id, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_bet_rejected_after_expiration() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let bettor = Address::generate(&s.env);
    fund(&s, &bettor, 100);
    s.env.ledger().with_mut(|l| l.timestamp = end_time);

    let err = s
        .client
        .try_place_bet(&bettor, &market_id, &true, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketExpired);
}

#[test]
fn test_resolve_rejected_before_expiration() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let err = s
        .client
        .try_resolve(&s.oracle, &market_id, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::MarketNotExpired);
}

#[test]
fn test_double_claim_rejected() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let bettor = Address::generate(&s.env);
    fund(&s, &bettor, 100);
    s.client.place_bet(&bettor, &market_id, &true, &100);

    s.env.ledger().with_mut(|l| l.timestamp = end_time + 1);
    s.client.resolve(&s.oracle, &market_id, &true);
    s.client.claim(&bettor, &market_id);

    let err = s
        .client
        .try_claim(&bettor, &market_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::AlreadyClaimed);
}

#[test]
fn test_claim_with_no_winning_stake_rejected() {
    let s = setup();
    let end_time = s.env.ledger().timestamp() + END_OFFSET;
    let market_id = s
        .client
        .create_market(&s.oracle, &question(&s.env), &end_time);

    let yes_bettor = Address::generate(&s.env);
    let no_bettor = Address::generate(&s.env);
    fund(&s, &yes_bettor, 100);
    fund(&s, &no_bettor, 100);
    s.client.place_bet(&yes_bettor, &market_id, &true, &100);
    s.client.place_bet(&no_bettor, &market_id, &false, &100);

    s.env.ledger().with_mut(|l| l.timestamp = end_time + 1);
    s.client.resolve(&s.oracle, &market_id, &true);

    let err = s
        .client
        .try_claim(&no_bettor, &market_id)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NoWinningStake);
}
