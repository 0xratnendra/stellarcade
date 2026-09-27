#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, String,
};

const QUORUM_BPS: u32 = 2_000; // 20%

fn setup(env: &Env) -> (StakedGovernanceClient<'_>, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(StakedGovernance, ());
    let client = StakedGovernanceClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&token_address, &QUORUM_BPS);

    (client, token_address)
}

fn mint_and_stake(
    env: &Env,
    client: &StakedGovernanceClient,
    token_address: &Address,
    voter: &Address,
    amount: i128,
) {
    StellarAssetClient::new(env, token_address).mint(voter, &amount);
    client.stake(voter, &amount);
}

// ---------------------------------------------------------------------------
// 1. staking tokens grants proportional voting weight
// ---------------------------------------------------------------------------

#[test]
fn test_staking_tokens_grants_proportional_voting_weight() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    StellarAssetClient::new(&env, &token_address).mint(&voter, &150);
    client.stake(&voter, &100);
    assert_eq!(client.get_staked(&voter), 100);
    assert_eq!(client.get_total_staked(), 100);

    client.stake(&voter, &50);
    assert_eq!(client.get_staked(&voter), 150);
    assert_eq!(client.get_total_staked(), 150);

    let description = String::from_str(&env, "Increase weekend tournament prize pool");
    let proposal_id = client.create_proposal(&voter, &description, &100);
    client.vote(&voter, &proposal_id, &VoteType::For);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.votes_for, 150);
}

// ---------------------------------------------------------------------------
// 2. proposal passing quorum executes successfully
// ---------------------------------------------------------------------------

#[test]
fn test_proposal_passing_quorum_executes_successfully() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter_a, 800);
    mint_and_stake(&env, &client, &token_address, &voter_b, 200);
    // total_staked = 1_000, quorum = 20% = 200

    let description = String::from_str(&env, "Ban smurfing in ranked ladder");
    let proposal_id = client.create_proposal(&voter_a, &description, &50);
    client.vote(&voter_a, &proposal_id, &VoteType::For); // 800 for, well past 200 quorum

    env.ledger().with_mut(|l| l.sequence_number = 100 + 50);
    client.execute(&proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.executed);
}

#[test]
fn test_proposal_below_quorum_rejected_on_execute() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter_a = Address::generate(&env);
    let voter_b = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter_a, 100);
    mint_and_stake(&env, &client, &token_address, &voter_b, 900);
    // total_staked = 1_000, quorum = 20% = 200

    let description = String::from_str(&env, "Reduce match timeout to 30s");
    let proposal_id = client.create_proposal(&voter_a, &description, &50);
    client.vote(&voter_a, &proposal_id, &VoteType::For); // only 100 for, below 200 quorum

    env.ledger().with_mut(|l| l.sequence_number = 100 + 50);
    let result = client.try_execute(&proposal_id);
    assert_eq!(result, Err(Ok(Error::QuorumNotReached)));
}

#[test]
fn test_execute_before_voting_closes_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Add spectator mode");
    let proposal_id = client.create_proposal(&voter, &description, &50);
    client.vote(&voter, &proposal_id, &VoteType::For);

    // Still within the voting window.
    let result = client.try_execute(&proposal_id);
    assert_eq!(result, Err(Ok(Error::VotingClosed)));
}

#[test]
fn test_execute_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Add spectator mode");
    let proposal_id = client.create_proposal(&voter, &description, &50);
    client.vote(&voter, &proposal_id, &VoteType::For);

    env.ledger().with_mut(|l| l.sequence_number = 100 + 50);
    client.execute(&proposal_id);

    let result = client.try_execute(&proposal_id);
    assert_eq!(result, Err(Ok(Error::AlreadyExecuted)));
}

// ---------------------------------------------------------------------------
// 3. rejection of votes cast after proposal end ledger
// ---------------------------------------------------------------------------

#[test]
fn test_vote_after_proposal_end_ledger_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Rotate map pool monthly");
    let proposal_id = client.create_proposal(&voter, &description, &50);

    env.ledger().with_mut(|l| l.sequence_number = 100 + 50);
    let result = client.try_vote(&voter, &proposal_id, &VoteType::For);
    assert_eq!(result, Err(Ok(Error::VotingClosed)));
}

#[test]
fn test_vote_exactly_at_end_ledger_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Rotate map pool monthly");
    let proposal_id = client.create_proposal(&voter, &description, &50);

    // end_ledger is exactly 150; voting must be closed AT 150, not just
    // after it.
    env.ledger().with_mut(|l| l.sequence_number = 150);
    let result = client.try_vote(&voter, &proposal_id, &VoteType::For);
    assert_eq!(result, Err(Ok(Error::VotingClosed)));
}

#[test]
fn test_vote_one_ledger_before_end_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Rotate map pool monthly");
    let proposal_id = client.create_proposal(&voter, &description, &50);

    env.ledger().with_mut(|l| l.sequence_number = 149);
    let result = client.try_vote(&voter, &proposal_id, &VoteType::For);
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// unstaking: cooldown + lock while committed to an active vote
// ---------------------------------------------------------------------------

#[test]
fn test_unstake_locked_while_vote_is_active() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Increase clan roster size");
    let proposal_id = client.create_proposal(&voter, &description, &50);
    client.vote(&voter, &proposal_id, &VoteType::For);

    let result = client.try_unstake(&voter, &500);
    assert_eq!(result, Err(Ok(Error::TokensCommittedToActiveVote)));
}

#[test]
fn test_unstake_allowed_after_voted_proposal_closes() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Increase clan roster size");
    let proposal_id = client.create_proposal(&voter, &description, &50);
    client.vote(&voter, &proposal_id, &VoteType::For);

    env.ledger().with_mut(|l| l.sequence_number = 100 + 50);
    let result = client.try_unstake(&voter, &500);
    assert!(result.is_ok());
}

#[test]
fn test_unstake_then_claim_after_cooldown() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    client.unstake(&voter, &400);
    assert_eq!(client.get_staked(&voter), 600);

    let result = client.try_claim_unstake(&voter);
    assert_eq!(result, Err(Ok(Error::CooldownNotExpired)));

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + types::UNSTAKE_COOLDOWN_LEDGERS);
    let claimed = client.claim_unstake(&voter);
    assert_eq!(claimed, 400);
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token_address).balance(&voter),
        400
    );
}

#[test]
fn test_claim_unstake_without_pending_request_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let result = client.try_claim_unstake(&voter);
    assert_eq!(result, Err(Ok(Error::NoPendingUnstake)));
}

#[test]
fn test_unstake_more_than_staked_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 100);

    let result = client.try_unstake(&voter, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientStake)));
}

#[test]
fn test_second_unstake_request_rejected_while_first_pending() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    client.unstake(&voter, &200);
    let result = client.try_unstake(&voter, &100);
    assert_eq!(result, Err(Ok(Error::TokensCommittedToActiveVote)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_double_vote_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let voter = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &voter, 1_000);

    let description = String::from_str(&env, "Add ranked season 3");
    let proposal_id = client.create_proposal(&voter, &description, &50);
    client.vote(&voter, &proposal_id, &VoteType::For);

    let result = client.try_vote(&voter, &proposal_id, &VoteType::Against);
    assert_eq!(result, Err(Ok(Error::AlreadyVoted)));
}

#[test]
fn test_create_proposal_requires_stake() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token_address) = setup(&env);

    let voter = Address::generate(&env);
    let description = String::from_str(&env, "Add ranked season 3");
    let result = client.try_create_proposal(&voter, &description, &50);
    assert_eq!(result, Err(Ok(Error::InsufficientStake)));
}

#[test]
fn test_vote_without_stake_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let proposer = Address::generate(&env);
    mint_and_stake(&env, &client, &token_address, &proposer, 1_000);
    let description = String::from_str(&env, "Add ranked season 3");
    let proposal_id = client.create_proposal(&proposer, &description, &50);

    let no_stake_voter = Address::generate(&env);
    let result = client.try_vote(&no_stake_voter, &proposal_id, &VoteType::For);
    assert_eq!(result, Err(Ok(Error::InsufficientStake)));
}

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token_address) = setup(&env);

    let result = client.try_initialize(&token_address, &QUORUM_BPS);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_rejects_invalid_quorum() {
    let env = Env::default();
    env.mock_all_auths();
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(StakedGovernance, ());
    let client = StakedGovernanceClient::new(&env, &contract_id);

    assert_eq!(
        client.try_initialize(&token_address, &0u32),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(
        client.try_initialize(&token_address, &10_001u32),
        Err(Ok(Error::InvalidInput))
    );
}
