#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, Symbol,
};

const AMOUNT: i128 = 10_000_000_000;

fn setup(env: &Env) -> (DecayingDutchAuctionClient<'_>, Address) {
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(DecayingDutchAuction, ());
    let client = DecayingDutchAuctionClient::new(env, &contract_id);
    client.initialize(&token_address);

    (client, token_address)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. price decay at 0%, 50%, and 100% of duration
// ---------------------------------------------------------------------------

#[test]
fn test_price_decay_at_0_50_100_percent_of_duration() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let (client, _token) = setup(&env);

    let seller = Address::generate(&env);
    let id = client.create_auction(
        &seller,
        &Symbol::new(&env, "skin_1"),
        &1_000i128,
        &200i128,
        &1_000u64,
    );

    // 0% elapsed: price == start_price.
    assert_eq!(client.get_current_price(&id), 1_000);

    // 50% elapsed: halfway between start and reserve.
    env.ledger().with_mut(|l| l.timestamp = 1_000 + 500);
    assert_eq!(client.get_current_price(&id), 600);

    // 100% elapsed: price == reserve_price exactly.
    env.ledger().with_mut(|l| l.timestamp = 1_000 + 1_000);
    assert_eq!(client.get_current_price(&id), 200);

    // Past duration: price stays floored at reserve_price, never below.
    env.ledger().with_mut(|l| l.timestamp = 1_000 + 5_000);
    assert_eq!(client.get_current_price(&id), 200);
}

// ---------------------------------------------------------------------------
// 2. buying transfers the current decaying price and closes the auction
// ---------------------------------------------------------------------------

#[test]
fn test_buy_transfers_decaying_price_and_closes_auction() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 0);
    let (client, token_address) = setup(&env);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    mint(&env, &token_address, &buyer, AMOUNT);

    let id = client.create_auction(
        &seller,
        &Symbol::new(&env, "skin_1"),
        &1_000i128,
        &200i128,
        &1_000u64,
    );

    env.ledger().with_mut(|l| l.timestamp = 500);
    let price_paid = client.buy(&buyer, &id, &600i128);
    assert_eq!(price_paid, 600);

    let token_client = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&seller), 600);
    assert_eq!(token_client.balance(&buyer), AMOUNT - 600);

    let auction = client.get_auction(&id);
    assert!(auction.closed);

    // A closed auction can no longer be bought.
    let result = client.try_buy(&buyer, &id, &1_000i128);
    assert_eq!(result, Err(Ok(Error::AuctionClosed)));
}

// ---------------------------------------------------------------------------
// 3. buying with a max_price below the current price is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_buy_paying_less_than_current_price_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 0);
    let (client, token_address) = setup(&env);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    mint(&env, &token_address, &buyer, AMOUNT);

    let id = client.create_auction(
        &seller,
        &Symbol::new(&env, "skin_1"),
        &1_000i128,
        &200i128,
        &1_000u64,
    );

    // Current price at t=0 is 1_000; offering only 500 must fail.
    let result = client.try_buy(&buyer, &id, &500i128);
    assert_eq!(result, Err(Ok(Error::PriceExceedsMax)));

    // Auction remains open and unaffected.
    let auction = client.get_auction(&id);
    assert!(!auction.closed);
}

// ---------------------------------------------------------------------------
// 4. seller can cancel an open auction; buyer cannot buy afterwards
// ---------------------------------------------------------------------------

#[test]
fn test_cancel_auction_closes_it_and_blocks_further_buys() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 0);
    let (client, token_address) = setup(&env);

    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);
    mint(&env, &token_address, &buyer, AMOUNT);

    let id = client.create_auction(
        &seller,
        &Symbol::new(&env, "skin_1"),
        &1_000i128,
        &200i128,
        &1_000u64,
    );

    client.cancel_auction(&seller, &id);

    let auction = client.get_auction(&id);
    assert!(auction.closed);

    let result = client.try_buy(&buyer, &id, &1_000i128);
    assert_eq!(result, Err(Ok(Error::AuctionClosed)));

    // Cancelling twice is rejected.
    let result = client.try_cancel_auction(&seller, &id);
    assert_eq!(result, Err(Ok(Error::AuctionClosed)));
}

// ---------------------------------------------------------------------------
// 5. only the seller may cancel
// ---------------------------------------------------------------------------

#[test]
fn test_only_seller_can_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token) = setup(&env);

    let seller = Address::generate(&env);
    let stranger = Address::generate(&env);

    let id = client.create_auction(
        &seller,
        &Symbol::new(&env, "skin_1"),
        &1_000i128,
        &200i128,
        &1_000u64,
    );

    let result = client.try_cancel_auction(&stranger, &id);
    assert_eq!(result, Err(Ok(Error::NotSeller)));
}

// ---------------------------------------------------------------------------
// 6. invalid auction parameters are rejected
// ---------------------------------------------------------------------------

#[test]
fn test_create_auction_rejects_invalid_input() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token) = setup(&env);

    let seller = Address::generate(&env);
    let item = Symbol::new(&env, "skin_1");

    // Reserve above start price.
    let result = client.try_create_auction(&seller, &item, &100i128, &200i128, &1_000u64);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));

    // Zero duration.
    let result = client.try_create_auction(&seller, &item, &1_000i128, &200i128, &0u64);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));

    // Non-positive start price.
    let result = client.try_create_auction(&seller, &item, &0i128, &0i128, &1_000u64);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}
