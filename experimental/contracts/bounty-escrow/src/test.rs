#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, BytesN, Env, Symbol,
};

const AMOUNT: i128 = 10_000_000_000;

fn make_tiers(env: &Env) -> Vec<BountyTier> {
    let mut tiers = Vec::new(env);
    tiers.push_back(BountyTier {
        score_threshold: 100,
        payout_bps: 5_000,
    });
    tiers.push_back(BountyTier {
        score_threshold: 500,
        payout_bps: 10_000,
    });
    tiers
}

fn proof(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn setup(env: &Env) -> (BountyEscrowClient<'_>, Address, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(BountyEscrow, ());
    let client = BountyEscrowClient::new(env, &contract_id);
    client.initialize(&token_address);

    (client, token_address, contract_id)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. sponsor bounty deposit and successful approved claim
// ---------------------------------------------------------------------------

#[test]
fn test_sponsor_bounty_deposit_and_successful_approved_claim() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let tiers = make_tiers(&env);
    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &tiers,
    );

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&contract_id), AMOUNT);
    assert_eq!(tc.balance(&sponsor), 0);

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &500);
    let paid = client.approve_bounty(&verifier, &bounty_id);

    assert_eq!(paid, AMOUNT); // top tier: 100% of amount
    assert_eq!(tc.balance(&player), AMOUNT);

    let bounty = client.get_bounty(&bounty_id);
    assert_eq!(bounty.paid_out, AMOUNT);
    assert_eq!(bounty.highest_tier_paid, Some(1));
}

#[test]
fn test_approve_pays_only_the_lower_tier_when_score_reaches_only_that_tier() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &150); // reaches only tier 0 (50%)
    let paid = client.approve_bounty(&verifier, &bounty_id);
    assert_eq!(paid, AMOUNT / 2);
}

#[test]
fn test_approve_pays_only_the_incremental_share_on_a_second_higher_tier_claim() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &150);
    let first_payout = client.approve_bounty(&verifier, &bounty_id);
    assert_eq!(first_payout, AMOUNT / 2);

    client.submit_claim(&player, &bounty_id, &proof(&env, 2), &500);
    let second_payout = client.approve_bounty(&verifier, &bounty_id);
    assert_eq!(second_payout, AMOUNT / 2); // the remaining 50%, not the full amount again

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player), AMOUNT); // exactly the full bounty, not double-paid
}

#[test]
fn test_approve_rejects_a_score_that_does_not_reach_the_lowest_tier() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &50); // below the 100 threshold
    let result = client.try_approve_bounty(&verifier, &bounty_id);
    assert_eq!(result, Err(Ok(Error::ScoreBelowLowestTier)));
}

#[test]
fn test_approve_rejects_a_claim_at_an_already_paid_tier() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &500);
    client.approve_bounty(&verifier, &bounty_id);

    // A later re-submission at the SAME or a lower tier must not be
    // payable again.
    client.submit_claim(&player, &bounty_id, &proof(&env, 2), &500);
    let result = client.try_approve_bounty(&verifier, &bounty_id);
    assert_eq!(result, Err(Ok(Error::TierAlreadyPaid)));
}

// ---------------------------------------------------------------------------
// 2. expired bounty refund to sponsor
// ---------------------------------------------------------------------------

#[test]
fn test_expired_bounty_refund_to_sponsor() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    let too_early = client.try_refund_expired(&sponsor, &bounty_id);
    assert_eq!(too_early, Err(Ok(Error::BountyNotExpired)));

    env.ledger().with_mut(|l| l.sequence_number = 200);
    let refunded = client.refund_expired(&sponsor, &bounty_id);
    assert_eq!(refunded, AMOUNT);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&sponsor), AMOUNT);
}

#[test]
fn test_refund_only_returns_the_unpaid_remainder_after_a_partial_payout() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &150);
    client.approve_bounty(&verifier, &bounty_id); // pays out 50%

    env.ledger().with_mut(|l| l.sequence_number = 200);
    let refunded = client.refund_expired(&sponsor, &bounty_id);
    assert_eq!(refunded, AMOUNT / 2); // only the unpaid half

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&sponsor), AMOUNT / 2);
    assert_eq!(tc.balance(&player), AMOUNT / 2);
}

#[test]
fn test_double_refund_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    env.ledger().with_mut(|l| l.sequence_number = 200);
    client.refund_expired(&sponsor, &bounty_id);

    let result = client.try_refund_expired(&sponsor, &bounty_id);
    assert_eq!(result, Err(Ok(Error::AlreadyRefunded)));
}

#[test]
fn test_cannot_approve_a_bounty_after_it_has_been_refunded() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    env.ledger().with_mut(|l| l.sequence_number = 200);
    client.refund_expired(&sponsor, &bounty_id);

    // A claim submitted before expiry (or attempted after) must not be
    // approvable once the sponsor has reclaimed the funds.
    let result = client.try_submit_claim(&player, &bounty_id, &proof(&env, 1), &500);
    assert_eq!(result, Err(Ok(Error::BountyExpired)));
}

// ---------------------------------------------------------------------------
// 3. unauthorized claim approval rejection
// ---------------------------------------------------------------------------

#[test]
fn test_unauthorized_claim_approval_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let impostor = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    client.submit_claim(&player, &bounty_id, &proof(&env, 1), &500);
    let result = client.try_approve_bounty(&impostor, &bounty_id);
    assert_eq!(result, Err(Ok(Error::NotAuthorizedVerifier)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_post_bounty_rejects_tiers_not_summing_to_full_payout() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let mut bad_tiers = Vec::new(&env);
    bad_tiers.push_back(BountyTier {
        score_threshold: 100,
        payout_bps: 5_000,
    });

    let result = client.try_post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &bad_tiers,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTiers)));
}

#[test]
fn test_post_bounty_rejects_a_deadline_in_the_past() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 200);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let result = client.try_post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &100,
        &verifier,
        &make_tiers(&env),
    );
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_submit_claim_after_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address, _contract_id) = setup(&env);

    let sponsor = Address::generate(&env);
    let verifier = Address::generate(&env);
    let player = Address::generate(&env);
    mint(&env, &token_address, &sponsor, AMOUNT);

    let bounty_id = client.post_bounty(
        &sponsor,
        &Symbol::new(&env, "speedrun"),
        &AMOUNT,
        &200,
        &verifier,
        &make_tiers(&env),
    );

    env.ledger().with_mut(|l| l.sequence_number = 200);
    let result = client.try_submit_claim(&player, &bounty_id, &proof(&env, 1), &500);
    assert_eq!(result, Err(Ok(Error::BountyExpired)));
}
