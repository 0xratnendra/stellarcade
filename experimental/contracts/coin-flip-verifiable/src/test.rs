#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env,
};

const WAGER: i128 = 100_0000000;
const FEE_BPS: u32 = 250; // 2.5%

fn setup(
    env: &Env,
    fee_bps: u32,
) -> (
    CoinFlipVerifiableClient<'_>,
    Address,
    Address,
    Address,
    Address,
) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(CoinFlipVerifiable, ());
    let client = CoinFlipVerifiableClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.initialize(&admin, &token_address, &fee_bps);

    let player1 = Address::generate(env);
    let player2 = Address::generate(env);

    (client, admin, player1, player2, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn salt_for(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn commitment_for(env: &Env, salt: &BytesN<32>, player: &Address) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, &salt.to_array());
    preimage.append(&player.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

/// Brute-force search for a salt byte such that, XORed against
/// `other_first_byte`, resolves to `target` — so tests can deterministically
/// steer the outcome without depending on `derive_outcome`'s formula beyond
/// "it's a deterministic function of both salts' first bytes".
fn find_salt_for_outcome(env: &Env, other_first_byte: u8, target: CoinSide) -> BytesN<32> {
    for byte in 0u8..=255 {
        let xored = byte ^ other_first_byte;
        let side = if xored.is_multiple_of(2) {
            CoinSide::Heads
        } else {
            CoinSide::Tails
        };
        if side == target {
            return salt_for(env, byte);
        }
    }
    panic!("no salt byte in 0..=255 resolves to the target side");
}

fn setup_revealing_game(
    env: &Env,
    choice: CoinSide,
) -> (
    CoinFlipVerifiableClient<'_>,
    Address,
    Address,
    Address,
    Address,
    u64,
) {
    let (client, admin, player1, player2, token_address) = setup(env, FEE_BPS);
    mint(env, &token_address, &player1, WAGER);
    mint(env, &token_address, &player2, WAGER);

    let salt1 = salt_for(env, 1);
    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(env, &salt1, &player1),
        &choice,
    );
    let salt2 = salt_for(env, 2);
    client.join_game(&player2, &game_id, &commitment_for(env, &salt2, &player2));

    (client, admin, player1, player2, token_address, game_id)
}

// ---------------------------------------------------------------------------
// 1. game creation locks tokens in escrow
// ---------------------------------------------------------------------------

#[test]
fn test_create_game_locks_tokens_in_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);

    let salt1 = salt_for(&env, 1);
    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player1), 0);
    assert_eq!(tc.balance(&client.address), WAGER);

    let game = client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Pending);
    assert_eq!(game.wager, WAGER);
}

#[test]
fn test_join_game_matches_wager_and_locks_second_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);
    mint(&env, &token_address, &player2, WAGER);

    let salt1 = salt_for(&env, 1);
    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );
    let salt2 = salt_for(&env, 2);
    client.join_game(&player2, &game_id, &commitment_for(&env, &salt2, &player2));

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&client.address), WAGER * 2);

    let game = client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Revealing);
    assert!(game.reveal_deadline.is_some());
}

// ---------------------------------------------------------------------------
// 2. valid reveal calculates winner and transfers double wager minus fee
// ---------------------------------------------------------------------------

#[test]
fn test_valid_reveal_calculates_winner_and_pays_double_wager_minus_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, player1, player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);
    mint(&env, &token_address, &player2, WAGER);

    let salt1 = salt_for(&env, 1);
    let salt2 = find_salt_for_outcome(&env, salt1.to_array()[0], CoinSide::Heads);

    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );
    client.join_game(&player2, &game_id, &commitment_for(&env, &salt2, &player2));

    client.reveal_seed(&player1, &game_id, &salt1);
    client.reveal_seed(&player2, &game_id, &salt2);

    let game = client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Settled);

    let pot = WAGER * 2;
    let fee = (pot * FEE_BPS as i128) / 10_000;
    let payout = pot - fee;

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player1), payout);
    assert_eq!(tc.balance(&player2), 0);
    assert_eq!(tc.balance(&admin), fee);
}

#[test]
fn test_valid_reveal_pays_player_two_when_outcome_favors_them() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);
    mint(&env, &token_address, &player2, WAGER);

    let salt1 = salt_for(&env, 1);
    let salt2 = find_salt_for_outcome(&env, salt1.to_array()[0], CoinSide::Tails);

    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );
    client.join_game(&player2, &game_id, &commitment_for(&env, &salt2, &player2));

    client.reveal_seed(&player1, &game_id, &salt1);
    client.reveal_seed(&player2, &game_id, &salt2);

    let pot = WAGER * 2;
    let fee = (pot * FEE_BPS as i128) / 10_000;
    let payout = pot - fee;

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player2), payout);
    assert_eq!(tc.balance(&player1), 0);
}

#[test]
fn test_reveal_with_wrong_secret_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let wrong_salt = salt_for(&env, 99);
    let result = client.try_reveal_seed(&player1, &game_id, &wrong_salt);
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));
    let _ = player2;
}

#[test]
fn test_double_reveal_by_same_player_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let salt1 = salt_for(&env, 1);
    client.reveal_seed(&player1, &game_id, &salt1);

    let result = client.try_reveal_seed(&player1, &game_id, &salt1);
    assert_eq!(result, Err(Ok(Error::AlreadyRevealed)));
}

// ---------------------------------------------------------------------------
// 3. timeout claim awards pot if opponent does not reveal in time
// ---------------------------------------------------------------------------

#[test]
fn test_timeout_claim_awards_pot_if_opponent_never_reveals() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let salt1 = salt_for(&env, 1);
    client.reveal_seed(&player1, &game_id, &salt1);

    env.ledger().with_mut(|li| {
        li.timestamp += types::REVEAL_WINDOW_SECONDS + 1;
    });

    let payout = client.claim_timeout(&player1, &game_id);
    assert_eq!(payout, WAGER * 2);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&player1), WAGER * 2);
    assert_eq!(tc.balance(&player2), 0);

    let game = client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Settled);
}

#[test]
fn test_timeout_claim_before_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let salt1 = salt_for(&env, 1);
    client.reveal_seed(&player1, &game_id, &salt1);

    let result = client.try_claim_timeout(&player1, &game_id);
    assert_eq!(result, Err(Ok(Error::TimeoutNotReached)));
}

#[test]
fn test_timeout_claim_by_non_revealer_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let salt1 = salt_for(&env, 1);
    client.reveal_seed(&player1, &game_id, &salt1);

    env.ledger().with_mut(|li| {
        li.timestamp += types::REVEAL_WINDOW_SECONDS + 1;
    });

    // player2 never revealed, so they have nothing to claim.
    let result = client.try_claim_timeout(&player2, &game_id);
    assert_eq!(result, Err(Ok(Error::NoRevealYet)));
}

#[test]
fn test_timeout_claim_when_neither_revealed_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    env.ledger().with_mut(|li| {
        li.timestamp += types::REVEAL_WINDOW_SECONDS + 1;
    });

    let result = client.try_claim_timeout(&player1, &game_id);
    assert_eq!(result, Err(Ok(Error::NoRevealYet)));
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _player1, _player2, token_address) = setup(&env, FEE_BPS);

    let result = client.try_initialize(&admin, &token_address, &FEE_BPS);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_rejects_fee_bps_over_100_percent() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let contract_id = env.register(CoinFlipVerifiable, ());
    let client = CoinFlipVerifiableClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &token_contract_id.address(), &10_001u32);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_create_game_rejects_non_positive_wager() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, _token_address) = setup(&env, FEE_BPS);

    let salt1 = salt_for(&env, 1);
    let result = client.try_create_game(
        &player1,
        &0,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_join_game_by_creator_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, _player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);

    let salt1 = salt_for(&env, 1);
    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt1, &player1),
        &CoinSide::Heads,
    );

    let result = client.try_join_game(&player1, &game_id, &commitment_for(&env, &salt1, &player1));
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_join_an_already_joined_game_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _player1, player2, token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let intruder = Address::generate(&env);
    mint(&env, &token_address, &intruder, WAGER);

    let salt = salt_for(&env, 3);
    let result = client.try_join_game(&intruder, &game_id, &commitment_for(&env, &salt, &intruder));
    assert_eq!(result, Err(Ok(Error::WrongGameState)));
    let _ = player2;
}

#[test]
fn test_a_player_cannot_use_the_others_commitment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, player1, player2, token_address) = setup(&env, FEE_BPS);
    mint(&env, &token_address, &player1, WAGER);
    mint(&env, &token_address, &player2, WAGER);

    // The commitment binds the specific committing player's own address,
    // so if player2 tried to join using a hash computed for player1's
    // address, revealing later would fail for player2.
    let shared_salt = salt_for(&env, 9);
    let commitment_bound_to_player1 = commitment_for(&env, &shared_salt, &player1);

    let game_id = client.create_game(
        &player1,
        &WAGER,
        &commitment_for(&env, &salt_for(&env, 1), &player1),
        &CoinSide::Heads,
    );
    client.join_game(&player2, &game_id, &commitment_bound_to_player1);

    let result = client.try_reveal_seed(&player2, &game_id, &shared_salt);
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));
}

#[test]
fn test_reveal_by_non_participant_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _player1, _player2, _token_address, game_id) =
        setup_revealing_game(&env, CoinSide::Heads);

    let impostor = Address::generate(&env);
    let result = client.try_reveal_seed(&impostor, &game_id, &salt_for(&env, 1));
    assert_eq!(result, Err(Ok(Error::NotAParticipant)));
}

#[test]
fn test_get_game_on_unknown_id_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, ..) = setup(&env, FEE_BPS);

    let result = client.try_get_game(&999);
    assert_eq!(result, Err(Ok(Error::NotFound)));
}
