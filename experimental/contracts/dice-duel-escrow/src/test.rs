#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, xdr::ToXdr, Address, Bytes, BytesN, Env,
};

const WAGER: i128 = 100_0000000;

fn setup(env: &Env) -> (DiceDuelEscrowClient<'_>, Address, Address, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(DiceDuelEscrow, ());
    let client = DiceDuelEscrowClient::new(env, &contract_id);

    let creator = Address::generate(env);
    let opponent = Address::generate(env);

    (client, creator, opponent, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn secret_for(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn commitment_for(env: &Env, secret: &BytesN<32>, player: &Address) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, &secret.to_array());
    preimage.append(&player.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

/// Brute-force search for a secret byte that resolves to exactly `target`
/// on `dice`, so tests can deterministically exercise a specific roll
/// without depending on the derivation formula beyond "it's deterministic
/// for a given secret".
fn find_secret_for_exact_roll(env: &Env, target: u32, dice: DiceSides) -> BytesN<32> {
    for byte in 0u8..=255 {
        let candidate = secret_for(env, byte);
        if roll_value(env, &candidate, dice) == target {
            return candidate;
        }
    }
    panic!("no secret byte in 0..=255 rolls exactly {target}");
}

fn setup_committing_duel(env: &Env) -> (DiceDuelEscrowClient<'_>, Address, Address, Address, u64) {
    let (client, creator, opponent, token_address) = setup(env);
    mint(env, &token_address, &creator, WAGER);
    mint(env, &token_address, &opponent, WAGER);

    let duel_id = client.create_duel(&creator, &opponent, &token_address, &WAGER, &DiceSides::D6);
    client.accept_duel(&opponent, &duel_id);

    (client, creator, opponent, token_address, duel_id)
}

// ---------------------------------------------------------------------------
// 1. player 1 (creator) higher roll sweeps escrow pool
// ---------------------------------------------------------------------------

#[test]
fn test_player_one_higher_roll_sweeps_escrow_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address, duel_id) = setup_committing_duel(&env);

    let creator_secret = find_secret_for_exact_roll(&env, 6, DiceSides::D6);
    let opponent_secret = find_secret_for_exact_roll(&env, 3, DiceSides::D6);

    client.commit_roll(
        &creator,
        &duel_id,
        &commitment_for(&env, &creator_secret, &creator),
    );
    client.commit_roll(
        &opponent,
        &duel_id,
        &commitment_for(&env, &opponent_secret, &opponent),
    );

    let creator_value = client.roll_dice(&creator, &duel_id, &creator_secret);
    assert_eq!(creator_value, 6);
    let opponent_value = client.roll_dice(&opponent, &duel_id, &opponent_secret);
    assert_eq!(opponent_value, 3);

    let duel = client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Settled);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&creator), WAGER * 2);
    assert_eq!(tc.balance(&opponent), 0);
}

#[test]
fn test_opponent_higher_roll_sweeps_escrow_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address, duel_id) = setup_committing_duel(&env);

    let creator_secret = find_secret_for_exact_roll(&env, 2, DiceSides::D6);
    let opponent_secret = find_secret_for_exact_roll(&env, 5, DiceSides::D6);

    client.commit_roll(
        &creator,
        &duel_id,
        &commitment_for(&env, &creator_secret, &creator),
    );
    client.commit_roll(
        &opponent,
        &duel_id,
        &commitment_for(&env, &opponent_secret, &opponent),
    );
    client.roll_dice(&creator, &duel_id, &creator_secret);
    client.roll_dice(&opponent, &duel_id, &opponent_secret);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&opponent), WAGER * 2);
    assert_eq!(tc.balance(&creator), 0);
}

// ---------------------------------------------------------------------------
// 2. equal rolls trigger pot split (or re-roll)
// ---------------------------------------------------------------------------

#[test]
fn test_equal_rolls_trigger_pot_split() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address, duel_id) = setup_committing_duel(&env);

    let creator_secret = find_secret_for_exact_roll(&env, 4, DiceSides::D6);
    let opponent_secret = find_secret_for_exact_roll(&env, 4, DiceSides::D6);

    client.commit_roll(
        &creator,
        &duel_id,
        &commitment_for(&env, &creator_secret, &creator),
    );
    client.commit_roll(
        &opponent,
        &duel_id,
        &commitment_for(&env, &opponent_secret, &opponent),
    );
    client.roll_dice(&creator, &duel_id, &creator_secret);
    client.roll_dice(&opponent, &duel_id, &opponent_secret);

    let duel = client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Tied);

    let split = client.settle_duel(&duel_id);
    assert_eq!(split, WAGER);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&creator), WAGER);
    assert_eq!(tc.balance(&opponent), WAGER);

    let settled = client.get_duel(&duel_id);
    assert_eq!(settled.status, DuelStatus::Settled);
}

#[test]
fn test_settle_duel_on_a_non_tied_duel_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, _token_address, duel_id) = setup_committing_duel(&env);

    let result = client.try_settle_duel(&duel_id);
    assert_eq!(result, Err(Ok(Error::WrongDuelState)));
    let _ = (creator, opponent);
}

// ---------------------------------------------------------------------------
// 3. cancel match before opponent joins refunds creator
// ---------------------------------------------------------------------------

#[test]
fn test_cancel_match_before_opponent_joins_refunds_creator() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &creator, WAGER);
    let duel_id = client.create_duel(&creator, &opponent, &token_address, &WAGER, &DiceSides::D6);

    let refunded = client.cancel_duel(&creator, &duel_id);
    assert_eq!(refunded, WAGER);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&creator), WAGER);

    let duel = client.get_duel(&duel_id);
    assert_eq!(duel.status, DuelStatus::Settled);
}

#[test]
fn test_cancel_by_non_creator_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &creator, WAGER);
    let duel_id = client.create_duel(&creator, &opponent, &token_address, &WAGER, &DiceSides::D6);

    let result = client.try_cancel_duel(&opponent, &duel_id);
    assert_eq!(result, Err(Ok(Error::NotAParticipant)));
}

#[test]
fn test_cancel_an_already_accepted_duel_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, _opponent, _token_address, duel_id) = setup_committing_duel(&env);

    let result = client.try_cancel_duel(&creator, &duel_id);
    assert_eq!(result, Err(Ok(Error::WrongDuelState)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_non_invitee_cannot_hijack_duel_acceptance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, token_address) = setup(&env);

    mint(&env, &token_address, &creator, WAGER);
    let duel_id = client.create_duel(&creator, &opponent, &token_address, &WAGER, &DiceSides::D6);

    let impostor = Address::generate(&env);
    let result = client.try_accept_duel(&impostor, &duel_id);
    assert_eq!(result, Err(Ok(Error::NotThePendingOpponent)));
}

#[test]
fn test_reveal_with_wrong_secret_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, _token_address, duel_id) = setup_committing_duel(&env);

    let real_secret = secret_for(&env, 1);
    let wrong_secret = secret_for(&env, 2);
    client.commit_roll(
        &creator,
        &duel_id,
        &commitment_for(&env, &real_secret, &creator),
    );
    client.commit_roll(
        &opponent,
        &duel_id,
        &commitment_for(&env, &secret_for(&env, 3), &opponent),
    );

    let result = client.try_roll_dice(&creator, &duel_id, &wrong_secret);
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));
}

#[test]
fn test_a_player_cannot_use_the_others_commitment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, opponent, _token_address, duel_id) = setup_committing_duel(&env);

    // The commitment binds the specific committing player's own address,
    // so if the opponent tried to commit using a hash computed for the
    // creator's address, revealing later would fail for the opponent.
    let shared_secret = secret_for(&env, 9);
    let commitment_bound_to_creator = commitment_for(&env, &shared_secret, &creator);

    client.commit_roll(&opponent, &duel_id, &commitment_bound_to_creator);
    client.commit_roll(
        &creator,
        &duel_id,
        &commitment_for(&env, &secret_for(&env, 3), &creator),
    );

    let result = client.try_roll_dice(&opponent, &duel_id, &shared_secret);
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));
}

#[test]
fn test_double_commit_by_the_same_player_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, _opponent, _token_address, duel_id) = setup_committing_duel(&env);

    let secret = secret_for(&env, 1);
    client.commit_roll(&creator, &duel_id, &commitment_for(&env, &secret, &creator));

    let result =
        client.try_commit_roll(&creator, &duel_id, &commitment_for(&env, &secret, &creator));
    assert_eq!(result, Err(Ok(Error::AlreadyCommitted)));
}

#[test]
fn test_create_duel_rejects_self_challenge() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, creator, _opponent, token_address) = setup(&env);

    mint(&env, &token_address, &creator, WAGER);
    let result = client.try_create_duel(&creator, &creator, &token_address, &WAGER, &DiceSides::D6);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_d20_roll_stays_within_bounds() {
    let env = Env::default();
    for byte in 0u8..=255 {
        let secret = secret_for(&env, byte);
        let value = roll_value(&env, &secret, DiceSides::D20);
        assert!((1..=20).contains(&value));
    }
}

#[test]
fn test_d6_roll_stays_within_bounds() {
    let env = Env::default();
    for byte in 0u8..=255 {
        let secret = secret_for(&env, byte);
        let value = roll_value(&env, &secret, DiceSides::D6);
        assert!((1..=6).contains(&value));
    }
}
