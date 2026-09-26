#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env,
};

const WAGER: i128 = 100_0000000;
const RESPONSE_TIMEOUT: u32 = 100;
const MATCH_TIMEOUT: u32 = 200;

fn setup(env: &Env) -> (TimeLockedWagerClient<'_>, Address, Address, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(TimeLockedWager, ());
    let client = TimeLockedWagerClient::new(env, &contract_id);

    let challenger = Address::generate(env);
    let opponent = Address::generate(env);

    (client, challenger, opponent, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. challenger cancels and reclaims expired challenge
// ---------------------------------------------------------------------------

#[test]
fn test_challenger_cancels_and_reclaims_expired_challenge() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );

    let too_early = client.try_cancel_expired_challenge(&challenger, &id);
    assert_eq!(too_early, Err(Ok(Error::ChallengeNotExpired)));

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + RESPONSE_TIMEOUT);
    let refunded = client.cancel_expired_challenge(&challenger, &id);
    assert_eq!(refunded, WAGER);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&challenger), WAGER);

    let challenge = client.get_challenge(&id);
    assert_eq!(challenge.status, ChallengeStatus::Cancelled);
}

#[test]
fn test_cancel_by_non_challenger_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + RESPONSE_TIMEOUT);
    let result = client.try_cancel_expired_challenge(&opponent, &id);
    assert_eq!(result, Err(Ok(Error::NotAParticipant)));
}

#[test]
fn test_cancel_an_already_accepted_challenge_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + RESPONSE_TIMEOUT);
    let result = client.try_cancel_expired_challenge(&challenger, &id);
    assert_eq!(result, Err(Ok(Error::WrongChallengeState)));
}

// ---------------------------------------------------------------------------
// 2. opponent timeout awards forfeit payout to active player
// ---------------------------------------------------------------------------

#[test]
fn test_opponent_timeout_awards_forfeit_payout_to_active_player() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    // Opponent goes unresponsive; challenger claims forfeit after the
    // match timeout.
    let accept_ledger = 100;
    env.ledger()
        .with_mut(|l| l.sequence_number = accept_ledger + MATCH_TIMEOUT);
    client.claim_timeout_forfeit(&challenger, &id);

    let challenge = client.get_challenge(&id);
    assert_eq!(challenge.status, ChallengeStatus::ForfeitClaimed);

    // Undisputed: finalize after the dispute grace period.
    let dispute_deadline = challenge.forfeit_dispute_deadline.unwrap();
    env.ledger()
        .with_mut(|l| l.sequence_number = dispute_deadline);
    let payout = client.finalize_forfeit(&id);

    assert_eq!(payout, WAGER * 2);
    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&challenger), WAGER * 2);
}

#[test]
fn test_disputed_forfeit_returns_challenge_to_active_without_payout() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    client.claim_timeout_forfeit(&challenger, &id);

    client.dispute_forfeit(&opponent, &id);

    let challenge = client.get_challenge(&id);
    assert_eq!(challenge.status, ChallengeStatus::Active);
    assert!(challenge.forfeit_accused.is_none());
    assert!(challenge.forfeit_claimant.is_none());
    assert!(challenge.forfeit_dispute_deadline.is_none());

    // No funds should have moved.
    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&challenger), 0);
    assert_eq!(tc.balance(&opponent), 0);
}

#[test]
fn test_dispute_by_someone_other_than_the_accused_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    client.claim_timeout_forfeit(&challenger, &id);

    // The claimant (challenger) cannot dispute their own claim.
    let result = client.try_dispute_forfeit(&challenger, &id);
    assert_eq!(result, Err(Ok(Error::NotTheAccusedPlayer)));
}

#[test]
fn test_dispute_after_the_grace_period_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    client.claim_timeout_forfeit(&challenger, &id);
    let challenge = client.get_challenge(&id);
    let dispute_deadline = challenge.forfeit_dispute_deadline.unwrap();

    env.ledger()
        .with_mut(|l| l.sequence_number = dispute_deadline);
    let result = client.try_dispute_forfeit(&opponent, &id);
    assert_eq!(result, Err(Ok(Error::DisputeWindowExpired)));
}

#[test]
fn test_forfeit_can_be_claimed_by_either_player_against_the_other() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    // Opponent claims that the CHALLENGER is the one who went AWOL.
    client.claim_timeout_forfeit(&opponent, &id);

    let challenge = client.get_challenge(&id);
    assert_eq!(challenge.forfeit_claimant.unwrap(), opponent);
    assert_eq!(challenge.forfeit_accused.unwrap(), challenger);
}

// ---------------------------------------------------------------------------
// 3. premature forfeit claim is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_premature_forfeit_claim_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    // Still well within the match timeout window.
    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT - 1);
    let result = client.try_claim_timeout_forfeit(&challenger, &id);
    assert_eq!(result, Err(Ok(Error::TimeoutNotYetReached)));
}

#[test]
fn test_forfeit_claim_on_a_still_pending_challenge_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );

    let result = client.try_claim_timeout_forfeit(&challenger, &id);
    assert_eq!(result, Err(Ok(Error::WrongChallengeState)));
}

#[test]
fn test_forfeit_claim_by_a_non_participant_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    let outsider = Address::generate(&env);
    let result = client.try_claim_timeout_forfeit(&outsider, &id);
    assert_eq!(result, Err(Ok(Error::NotAParticipant)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_accept_challenge_after_response_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + RESPONSE_TIMEOUT);
    let result = client.try_accept_challenge(&opponent, &id, &MATCH_TIMEOUT);
    assert_eq!(result, Err(Ok(Error::ChallengeExpired)));
}

#[test]
fn test_accept_challenge_by_wrong_opponent_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );

    let impostor = Address::generate(&env);
    let result = client.try_accept_challenge(&impostor, &id, &MATCH_TIMEOUT);
    assert_eq!(result, Err(Ok(Error::NotThePendingOpponent)));
}

#[test]
fn test_create_challenge_rejects_self_challenge() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, challenger, _opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    let result = client.try_create_challenge(
        &challenger,
        &challenger,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_finalize_forfeit_before_dispute_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, challenger, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &challenger, WAGER);
    mint(&env, &token_address, &opponent, WAGER);
    let id = client.create_challenge(
        &challenger,
        &opponent,
        &token_address,
        &WAGER,
        &RESPONSE_TIMEOUT,
    );
    client.accept_challenge(&opponent, &id, &MATCH_TIMEOUT);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + MATCH_TIMEOUT);
    client.claim_timeout_forfeit(&challenger, &id);

    let result = client.try_finalize_forfeit(&id);
    assert_eq!(result, Err(Ok(Error::TimeoutNotYetReached)));
}
