#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::types::{Error, MarketPhase, CHALLENGE_WINDOW_LEDGERS};
use crate::{PredictionMarketDispute, PredictionMarketDisputeClient};

const BOND: i128 = 1_000;

struct Setup {
    env: Env,
    client: PredictionMarketDisputeClient<'static>,
    token: token::Client<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(PredictionMarketDispute, ());
    let client = PredictionMarketDisputeClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address());

    Setup {
        token: token::Client::new(&env, &sac.address()),
        env,
        client,
        admin,
    }
}

fn fund(s: &Setup, addr: &Address, amount: i128) {
    token::StellarAssetClient::new(&s.env, &s.token.address).mint(addr, &amount);
}

#[test]
fn test_undisputed_resolution_path() {
    let s = setup();
    let oracle = Address::generate(&s.env);
    fund(&s, &oracle, BOND);

    s.client.report_outcome(&oracle, &1, &true, &BOND);
    let status = s.client.get_market_dispute_status(&1);
    assert!(status.found);
    assert!(status.payouts_frozen);

    s.env.ledger().with_mut(|l| {
        l.sequence_number = CHALLENGE_WINDOW_LEDGERS + 1;
    });
    s.client.finalize_undisputed(&1);

    let finalized = s.client.get_market_dispute_status(&1);
    assert_eq!(finalized.phase, MarketPhase::Finalized);
    assert!(!finalized.payouts_frozen);

    let payout = s.client.claim_resolution_payout(&oracle, &1);
    assert_eq!(payout, BOND);
}

#[test]
fn test_disputed_challenge_path() {
    let s = setup();
    let oracle = Address::generate(&s.env);
    let challenger = Address::generate(&s.env);
    fund(&s, &oracle, BOND);
    fund(&s, &challenger, BOND);

    s.client.report_outcome(&oracle, &2, &true, &BOND);
    s.client.challenge_outcome(&challenger, &2, &BOND);

    let disputed = s.client.get_market_dispute_status(&2);
    assert!(disputed.disputed);
    assert!(disputed.payouts_frozen);

    s.client.arbitrate(&s.admin, &2, &false);

    let payout = s.client.claim_resolution_payout(&challenger, &2);
    assert_eq!(payout, BOND * 2);
}

#[test]
fn test_expired_challenge_and_unauthorized_arbiter() {
    let s = setup();
    let oracle = Address::generate(&s.env);
    let challenger = Address::generate(&s.env);
    let impostor = Address::generate(&s.env);
    fund(&s, &oracle, BOND);
    fund(&s, &challenger, BOND);

    s.client.report_outcome(&oracle, &3, &false, &BOND);
    s.env.ledger().with_mut(|l| {
        l.sequence_number = CHALLENGE_WINDOW_LEDGERS + 5;
    });

    let err = s
        .client
        .try_challenge_outcome(&challenger, &3, &BOND)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::ChallengeWindowClosed);

    fund(&s, &oracle, BOND);
    s.client.report_outcome(&oracle, &4, &true, &BOND);
    s.client.challenge_outcome(&challenger, &4, &BOND);
    let err = s
        .client
        .try_arbitrate(&impostor, &4, &false)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);
}
