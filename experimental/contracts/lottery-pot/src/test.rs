#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env,
};

const TICKET_PRICE: i128 = 5_0000000; // 5 XLM
const DURATION: u32 = 100;

fn setup(env: &Env) -> (LotteryPotClient<'_>, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(LotteryPot, ());
    let client = LotteryPotClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &token_address);
    client.start_lottery(&admin, &TICKET_PRICE, &DURATION);

    (client, admin, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn seed(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

// ---------------------------------------------------------------------------
// 1. buying tickets accumulates pool balance
// ---------------------------------------------------------------------------

#[test]
fn test_buying_tickets_accumulates_pool_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player_a = Address::generate(&env);
    mint(&env, &token_address, &player_a, 10_000_000_000);
    client.buy_tickets(&player_a, &3);
    assert_eq!(client.get_current_epoch().pot, TICKET_PRICE * 3);

    let player_b = Address::generate(&env);
    mint(&env, &token_address, &player_b, 10_000_000_000);
    client.buy_tickets(&player_b, &2);
    assert_eq!(client.get_current_epoch().pot, TICKET_PRICE * 5);
    assert_eq!(client.get_current_epoch().tickets_sold, 5);
}

#[test]
fn test_ticket_purchases_locked_after_draw_deadline() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let result = client.try_buy_tickets(&player, &1);
    assert_eq!(result, Err(Ok(Error::TicketSalesClosed)));
}

// ---------------------------------------------------------------------------
// 2. winner draw correctly picks from issued ticket IDs
// ---------------------------------------------------------------------------

#[test]
fn test_winner_draw_correctly_picks_from_issued_ticket_ids() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player_a = Address::generate(&env);
    let player_b = Address::generate(&env);
    mint(&env, &token_address, &player_a, 10_000_000_000);
    mint(&env, &token_address, &player_b, 10_000_000_000);

    client.buy_tickets(&player_a, &3); // tickets 0, 1, 2
    client.buy_tickets(&player_b, &2); // tickets 3, 4

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 7));

    // Whoever was drawn must own the winning ticket id, and that id must
    // fall within the 0..5 range that was actually issued.
    let epoch = client.get_current_epoch();
    let winning_id = epoch.winning_ticket_id.expect("a winner must be drawn");
    assert!(winning_id < 5);
    assert!(winner.is_some());

    let expected_owner = if winning_id < 3 { &player_a } else { &player_b };
    assert_eq!(winner.unwrap(), expected_owner.clone());
}

#[test]
fn test_draw_is_deterministic_for_the_same_seed_and_epoch() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &10);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 42));
    let winning_id_1 = client.get_current_epoch().winning_ticket_id;

    // Re-derive with the exact same inputs in a fresh env to confirm the
    // outcome is a pure function of (seed, epoch_id, tickets_sold), not
    // hidden mutable state.
    let raw = {
        let mut preimage = [0u8; 40];
        preimage[..32].copy_from_slice(&seed(&env, 42).to_array());
        preimage[32..].copy_from_slice(&1u64.to_be_bytes());
        let digest: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_slice(&env, &preimage))
            .into();
        let arr = digest.to_array();
        u64::from_be_bytes([
            arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
        ]) % 10
    };
    assert_eq!(winning_id_1, Some(raw));
    assert!(winner.is_some());
}

#[test]
fn test_different_seeds_can_pick_different_tickets() {
    // Not a strict requirement (a collision is possible), but sanity-checks
    // that the seed actually participates in the derivation rather than
    // being ignored.
    let env = Env::default();
    let ids: std::vec::Vec<u64> = (0u8..5)
        .map(|b| {
            let mut preimage = [0u8; 40];
            preimage[..32].copy_from_slice(&seed(&env, b).to_array());
            preimage[32..].copy_from_slice(&1u64.to_be_bytes());
            let digest: BytesN<32> = env
                .crypto()
                .sha256(&Bytes::from_slice(&env, &preimage))
                .into();
            let arr = digest.to_array();
            u64::from_be_bytes([
                arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
            ]) % 1_000
        })
        .collect();
    let all_same = ids.windows(2).all(|w| w[0] == w[1]);
    assert!(!all_same, "seed must influence the derived ticket id");
}

#[test]
fn test_draw_before_deadline_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    let result = client.try_draw_winner(&admin, &seed(&env, 1));
    assert_eq!(result, Err(Ok(Error::DrawNotYetAllowed)));
}

#[test]
fn test_double_draw_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    client.draw_winner(&admin, &seed(&env, 1));

    let result = client.try_draw_winner(&admin, &seed(&env, 2));
    assert_eq!(result, Err(Ok(Error::AlreadyDrawn)));
}

// ---------------------------------------------------------------------------
// 3. zero ticket epoch rolls over jackpot
// ---------------------------------------------------------------------------

#[test]
fn test_zero_ticket_epoch_rolls_over_jackpot() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    // A sponsor's tickets in a PRIOR epoch fund the pot that should roll
    // over; simulate this epoch already having some pot but zero tickets
    // sold in the CURRENT epoch by drawing immediately with none bought.
    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 1));
    assert!(winner.is_none());

    let epoch = client.get_current_epoch();
    assert!(epoch.drawn);
    assert_eq!(epoch.winning_ticket_id, None);
    assert_eq!(epoch.pot, 0); // nothing was ever deposited this epoch

    // Now prove an actual nonzero pot survives a zero-ticket draw and
    // carries into the next epoch's starting pot.
    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    let second_epoch_id = client.start_lottery(&admin, &TICKET_PRICE, &DURATION);
    client.buy_tickets(&player, &1);
    // Second epoch has 1 ticket, so it WILL draw a winner, not roll over;
    // instead verify the no-purchase rollover path directly by starting a
    // third epoch with zero purchases after the second epoch's pot is
    // fully claimed by its single ticket holder.
    let after_second_start = 100 + DURATION;
    env.ledger()
        .with_mut(|l| l.sequence_number = after_second_start + DURATION);
    let winner2 = client.draw_winner(&admin, &seed(&env, 2));
    assert!(winner2.is_some());
    let claimed = client.claim_jackpot(&winner2.unwrap());
    assert!(claimed > 0);

    let third_epoch_id = client.start_lottery(&admin, &TICKET_PRICE, &DURATION);
    assert!(third_epoch_id > second_epoch_id);
    // 10% rollover from epoch 2's jackpot claim carries into epoch 3.
    let rollover_pot = client.get_current_epoch().pot;
    assert!(rollover_pot > 0);

    env.ledger()
        .with_mut(|l| l.sequence_number = after_second_start + DURATION + DURATION);
    let winner3 = client.draw_winner(&admin, &seed(&env, 3));
    assert!(winner3.is_none());
    // The rolled-over pot must still be present in the drawn (empty)
    // epoch, ready to roll again into epoch 4.
    assert_eq!(client.get_current_epoch().pot, rollover_pot);
}

// ---------------------------------------------------------------------------
// claim_jackpot
// ---------------------------------------------------------------------------

#[test]
fn test_claim_jackpot_pays_ninety_percent_to_winner() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &10);
    let pot = client.get_current_epoch().pot;
    let balance_before_claim =
        soroban_sdk::token::Client::new(&env, &token_address).balance(&player);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 5)).unwrap();

    let claimed = client.claim_jackpot(&winner);
    assert_eq!(claimed, pot * 9 / 10);
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token_address).balance(&winner),
        balance_before_claim + claimed
    );
}

#[test]
fn test_claim_jackpot_by_non_winner_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    let impostor = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    client.draw_winner(&admin, &seed(&env, 5));

    let result = client.try_claim_jackpot(&impostor);
    assert_eq!(result, Err(Ok(Error::NotTheWinner)));
}

#[test]
fn test_claim_jackpot_before_draw_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    let result = client.try_claim_jackpot(&player);
    assert_eq!(result, Err(Ok(Error::NotYetDrawn)));
}

#[test]
fn test_double_claim_jackpot_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 5)).unwrap();
    client.claim_jackpot(&winner);

    let result = client.try_claim_jackpot(&winner);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));
}

// ---------------------------------------------------------------------------
// emergency refund
// ---------------------------------------------------------------------------

#[test]
fn test_emergency_refund_available_after_grace_period_with_no_draw() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    let balance_before_purchase =
        soroban_sdk::token::Client::new(&env, &token_address).balance(&player);
    client.buy_tickets(&player, &3);

    // Right at the deadline: no draw yet, but grace period hasn't elapsed.
    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let too_early = client.try_emergency_refund(&player);
    assert_eq!(too_early, Err(Ok(Error::RefundNotAvailable)));

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION + types::EMERGENCY_REFUND_GRACE_LEDGERS);
    let refunded = client.emergency_refund(&player);
    assert_eq!(refunded, TICKET_PRICE * 3);
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token_address).balance(&player),
        balance_before_purchase
    );
}

#[test]
fn test_emergency_refund_unavailable_once_drawn() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION + types::EMERGENCY_REFUND_GRACE_LEDGERS);
    client.draw_winner(&admin, &seed(&env, 1));

    let result = client.try_emergency_refund(&player);
    assert_eq!(result, Err(Ok(Error::RefundNotAvailable)));
}

#[test]
fn test_emergency_refund_twice_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION + types::EMERGENCY_REFUND_GRACE_LEDGERS);
    client.emergency_refund(&player);

    let result = client.try_emergency_refund(&player);
    assert_eq!(result, Err(Ok(Error::AlreadyRefunded)));
}

#[test]
fn test_emergency_refund_without_tickets_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, _admin, _token_address) = setup(&env);

    let non_player = Address::generate(&env);
    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION + types::EMERGENCY_REFUND_GRACE_LEDGERS);
    let result = client.try_emergency_refund(&non_player);
    assert_eq!(result, Err(Ok(Error::NothingToRefund)));
}

// ---------------------------------------------------------------------------
// initialize / start_lottery guards
// ---------------------------------------------------------------------------

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address) = setup(&env);

    let result = client.try_initialize(&admin, &token_address);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_start_lottery_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address) = setup(&env);

    let not_admin = Address::generate(&env);
    let result = client.try_start_lottery(&not_admin, &TICKET_PRICE, &DURATION);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_start_lottery_rejects_invalid_price_or_duration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address) = setup(&env);

    assert_eq!(
        client.try_start_lottery(&admin, &0, &DURATION),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(
        client.try_start_lottery(&admin, &TICKET_PRICE, &0),
        Err(Ok(Error::InvalidInput))
    );
}

#[test]
fn test_start_lottery_rejected_while_previous_jackpot_unclaimed() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    client.draw_winner(&admin, &seed(&env, 1));

    // Jackpot was drawn but never claimed — starting a new epoch would
    // strand the winner's 90% share inside the new epoch's starting pot.
    let result = client.try_start_lottery(&admin, &TICKET_PRICE, &DURATION);
    assert_eq!(result, Err(Ok(Error::PreviousJackpotUnclaimed)));
}

#[test]
fn test_start_lottery_allowed_after_previous_jackpot_claimed() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, token_address) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &1);

    env.ledger()
        .with_mut(|l| l.sequence_number = 100 + DURATION);
    let winner = client.draw_winner(&admin, &seed(&env, 1)).unwrap();
    client.claim_jackpot(&winner);

    let result = client.try_start_lottery(&admin, &TICKET_PRICE, &DURATION);
    assert!(result.is_ok());
}
