#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env,
};

use crate::{commitment_hash, SealedBidDuel, SealedBidDuelClient};
use crate::types::{DuelPhase, Error, MIN_WAGER, REVEAL_WINDOW_LEDGERS};

const STAKE: i128 = 100_000;

struct Setup {
    env: Env,
    client: SealedBidDuelClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(SealedBidDuel, ());
    let client = SealedBidDuelClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address());

    Setup {
        token: token::Client::new(&env, &sac.address()),
        token_admin: token::StellarAssetClient::new(&env, &sac.address()),
        env,
        client,
        admin,
    }
}

fn salt(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn commit(env: &Env, wager: i128, salt_byte: u8) -> BytesN<32> {
    commitment_hash(env, wager, &salt(env, salt_byte))
}

fn fund(s: &Setup, who: &Address) {
    s.token_admin.mint(who, &(STAKE * 2));
}

#[test]
fn test_both_reveal_and_highest_bidder_wins() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    // Creator wagers 80k, opponent wagers 60k (hidden until reveal).
    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    let duel = s.client.get_duel(&duel_id);
    assert_eq!(duel.phase, DuelPhase::Committed);

    s.client.reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
    s.client.reveal_bid(&opponent, &duel_id, &60_000, &salt(&s.env, 2));

    s.client.finalize_duel(&duel_id);

    let duel = s.client.get_duel(&duel_id);
    assert_eq!(duel.phase, DuelPhase::Finalized);
    assert_eq!(duel.winner, Some(creator.clone()));

    // Second-price: the loser refunds the excess of the winning bid over the
    // second (losing) bid — 80k − 60k = 20k, capped at the stake.
    // Winner payout = stake + excess = 120k; loser keeps stake − excess = 80k.
    // (Both started with 2×stake after the mint.)
    assert_eq!(s.token.balance(&creator), STAKE * 2 - STAKE + 120_000);
    assert_eq!(s.token.balance(&opponent), STAKE * 2 - STAKE + 80_000);
}

#[test]
fn test_failure_to_reveal_in_window_forfeits() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    // Only the creator reveals; the opponent goes silent past the deadline.
    s.client.reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
    s.env.ledger().with_mut(|l| {
        l.sequence_number += REVEAL_WINDOW_LEDGERS;
    });
    s.client.finalize_duel(&duel_id);

    let duel = s.client.get_duel(&duel_id);
    assert_eq!(duel.phase, DuelPhase::Forfeited);
    assert_eq!(duel.winner, Some(creator.clone()));
    // Forfeit: creator takes the whole pot (started with 2×stake, paid 1×).
    assert_eq!(s.token.balance(&creator), STAKE * 3);
    assert_eq!(s.token.balance(&opponent), STAKE);
}

#[test]
fn test_hash_salt_mismatch_rejected() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    // Wrong salt → explicit CommitmentMismatch, reveal rejected.
    let result = s.client.try_reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 9));
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));

    // Wrong amount with the right salt → also rejected.
    let result = s.client.try_reveal_bid(&creator, &duel_id, &70_000, &salt(&s.env, 1));
    assert_eq!(result, Err(Ok(Error::CommitmentMismatch)));

    // The correct reveal still succeeds afterwards.
    s.client.reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
}

#[test]
fn test_outsider_cannot_reveal() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    let outsider = Address::generate(&s.env);
    let result = s.client.try_reveal_bid(&outsider, &duel_id, &80_000, &salt(&s.env, 1));
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_double_reveal_rejected() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    s.client.reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
    let result = s.client.try_reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
    assert_eq!(result, Err(Ok(Error::AlreadyRevealed)));
}

#[test]
fn test_cannot_join_twice_or_own_duel() {
    let s = setup();
    let creator = Address::generate(&s.env);
    fund(&s, &creator);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    // Creator joining own duel.
    let result = s.client.try_join_duel(&creator, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);
    assert_eq!(result, Err(Ok(Error::AlreadyJoined)));

    // Stake mismatch.
    let third = Address::generate(&s.env);
    fund(&s, &third);
    let result = s.client.try_join_duel(&third, &duel_id, &commit(&s.env, 60_000, 2), &(STAKE - MIN_WAGER));
    assert_eq!(result, Err(Ok(Error::InvalidStake)));
}

#[test]
fn test_finalize_before_reveals_rejected() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 60_000, 2), &STAKE);

    let result = s.client.try_finalize_duel(&duel_id);
    assert_eq!(result, Err(Ok(Error::RevealWindowOpen)));
}

#[test]
fn test_below_min_wager_rejected() {
    let s = setup();
    let creator = Address::generate(&s.env);
    fund(&s, &creator);
    let result = s.client.try_create_duel(&creator, &commit(&s.env, 80_000, 1), &(MIN_WAGER - 1));
    assert_eq!(result, Err(Ok(Error::InvalidStake)));
}

#[test]
fn test_tie_goes_to_creator() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let opponent = Address::generate(&s.env);
    fund(&s, &creator);
    fund(&s, &opponent);

    let duel_id = s.client.create_duel(&creator, &commit(&s.env, 80_000, 1), &STAKE);
    s.client.join_duel(&opponent, &duel_id, &commit(&s.env, 80_000, 2), &STAKE);
    s.client.reveal_bid(&creator, &duel_id, &80_000, &salt(&s.env, 1));
    s.client.reveal_bid(&opponent, &duel_id, &80_000, &salt(&s.env, 2));
    s.client.finalize_duel(&duel_id);

    let duel = s.client.get_duel(&duel_id);
    assert_eq!(duel.winner, Some(creator.clone()));
    // Tie: zero excess → both get exactly their stake back (net zero change).
    assert_eq!(s.token.balance(&creator), STAKE * 2);
    assert_eq!(s.token.balance(&opponent), STAKE * 2);
}

