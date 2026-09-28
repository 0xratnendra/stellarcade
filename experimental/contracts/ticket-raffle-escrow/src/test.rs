#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, BytesN, Env,
};

const TICKET_PRICE: i128 = 5_0000000; // 5 XLM
const MAX_TICKETS_PER_WALLET: u64 = 3;

fn setup(env: &Env) -> (TicketRaffleEscrowClient<'_>, Address, Address, u64) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(TicketRaffleEscrow, ());
    let client = TicketRaffleEscrowClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &token_address);

    let end_time = env.ledger().timestamp() + 1000;
    let raffle_id = client.create_raffle(&admin, &TICKET_PRICE, &end_time, &MAX_TICKETS_PER_WALLET);

    (client, admin, token_address, raffle_id)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

fn seed(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

// ---------------------------------------------------------------------------
// 1. ticket purchase increases player ticket count and pool balance
// ---------------------------------------------------------------------------

#[test]
fn test_ticket_purchase_increases_count_and_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    client.buy_tickets(&player, &raffle_id, &2);

    assert_eq!(client.get_player_ticket_count(&raffle_id, &player), 2);
    assert_eq!(client.get_raffle(&raffle_id).pool, TICKET_PRICE * 2);
    assert_eq!(client.get_raffle(&raffle_id).tickets_sold, 2);
}

#[test]
fn test_multiple_players_accumulate_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, raffle_id) = setup(&env);

    let player_a = Address::generate(&env);
    mint(&env, &token_address, &player_a, 10_000_000_000);
    client.buy_tickets(&player_a, &raffle_id, &2);

    let player_b = Address::generate(&env);
    mint(&env, &token_address, &player_b, 10_000_000_000);
    client.buy_tickets(&player_b, &raffle_id, &1);

    assert_eq!(client.get_raffle(&raffle_id).pool, TICKET_PRICE * 3);
    assert_eq!(client.get_raffle(&raffle_id).tickets_sold, 3);
}

#[test]
fn test_ticket_purchase_locked_after_end_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    env.ledger().with_mut(|l| l.timestamp += 2000);
    let result = client.try_buy_tickets(&player, &raffle_id, &1);
    assert_eq!(result, Err(Ok(Error::RaffleClosed)));
}

// ---------------------------------------------------------------------------
// 2. cannot purchase tickets exceeding max ticket cap
// ---------------------------------------------------------------------------

#[test]
fn test_cannot_exceed_max_tickets_per_wallet() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    client.buy_tickets(&player, &raffle_id, &MAX_TICKETS_PER_WALLET);

    let result = client.try_buy_tickets(&player, &raffle_id, &1);
    assert_eq!(result, Err(Ok(Error::MaxTicketsPerWalletExceeded)));
}

#[test]
fn test_exact_max_tickets_per_wallet_is_allowed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);

    client.buy_tickets(&player, &raffle_id, &MAX_TICKETS_PER_WALLET);
    assert_eq!(
        client.get_player_ticket_count(&raffle_id, &player),
        MAX_TICKETS_PER_WALLET
    );
}

// ---------------------------------------------------------------------------
// 3. drawing winner correctly selects ticket and transfers pool prize
// ---------------------------------------------------------------------------

#[test]
fn test_draw_winner_selects_ticket_and_transfers_prize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, raffle_id) = setup(&env);

    let player_a = Address::generate(&env);
    mint(&env, &token_address, &player_a, 10_000_000_000);
    client.buy_tickets(&player_a, &raffle_id, &2);

    let player_b = Address::generate(&env);
    mint(&env, &token_address, &player_b, 10_000_000_000);
    client.buy_tickets(&player_b, &raffle_id, &1);

    let expected_pool = TICKET_PRICE * 3;

    env.ledger().with_mut(|l| l.timestamp += 2000);
    let winner = client.draw_winner(&admin, &raffle_id, &seed(&env, 7));

    assert!(winner == player_a || winner == player_b);

    let raffle = client.get_raffle(&raffle_id);
    assert!(raffle.drawn);
    assert!(raffle.prize_claimed);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(
        token_client.balance(&winner),
        10_000_000_000
            - if winner == player_a {
                TICKET_PRICE * 2
            } else {
                TICKET_PRICE
            }
            + expected_pool
    );
}

#[test]
fn test_cannot_draw_before_end_time() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &raffle_id, &1);

    let result = client.try_draw_winner(&admin, &raffle_id, &seed(&env, 1));
    assert_eq!(result, Err(Ok(Error::DrawNotYetAllowed)));
}

#[test]
fn test_cannot_draw_with_zero_tickets_sold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address, raffle_id) = setup(&env);

    env.ledger().with_mut(|l| l.timestamp += 2000);
    let result = client.try_draw_winner(&admin, &raffle_id, &seed(&env, 1));
    assert_eq!(result, Err(Ok(Error::NoTicketsSold)));
}

#[test]
fn test_cannot_draw_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, raffle_id) = setup(&env);

    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &raffle_id, &1);

    env.ledger().with_mut(|l| l.timestamp += 2000);
    client.draw_winner(&admin, &raffle_id, &seed(&env, 1));

    let result = client.try_draw_winner(&admin, &raffle_id, &seed(&env, 2));
    assert_eq!(result, Err(Ok(Error::AlreadyDrawn)));
}

#[test]
fn test_deterministic_seed_selects_correct_ticket_owner() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, raffle_id) = setup(&env);

    // A single player owns every ticket, so the winner must be them
    // regardless of which ticket id the seed derives.
    let player = Address::generate(&env);
    mint(&env, &token_address, &player, 10_000_000_000);
    client.buy_tickets(&player, &raffle_id, &MAX_TICKETS_PER_WALLET);

    env.ledger().with_mut(|l| l.timestamp += 2000);
    let winner = client.draw_winner(&admin, &raffle_id, &seed(&env, 42));
    assert_eq!(winner, player);
}
