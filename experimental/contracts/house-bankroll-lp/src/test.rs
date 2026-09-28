#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::types::{Error, WITHDRAW_LOCKUP_LEDGERS};
use crate::{HouseBankrollLp, HouseBankrollLpClient};

struct Setup {
    env: Env,
    client: HouseBankrollLpClient<'static>,
    token: token::Client<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(HouseBankrollLp, ());
    let client = HouseBankrollLpClient::new(&env, &contract_id);

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
fn test_lp_receives_correct_shares_on_deposit() {
    let s = setup();
    let provider_a = Address::generate(&s.env);
    let provider_b = Address::generate(&s.env);
    fund(&s, &provider_a, 1_000);
    fund(&s, &provider_b, 500);

    // First deposit into an empty vault mints 1:1.
    let shares_a = s.client.deposit_liquidity(&provider_a, &1_000);
    assert_eq!(shares_a, 1_000);
    assert_eq!(s.client.get_shares(&provider_a), 1_000);
    assert_eq!(s.client.get_total_tvl(), 1_000);

    // Second deposit at unchanged equity mints pro-rata (still 1:1 here).
    let shares_b = s.client.deposit_liquidity(&provider_b, &500);
    assert_eq!(shares_b, 500);
    assert_eq!(s.client.get_shares(&provider_b), 500);
    assert_eq!(s.client.get_total_tvl(), 1_500);
}

#[test]
fn test_game_profits_increase_lp_share_redemption_value() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    let game = Address::generate(&s.env);
    s.client.set_game_authorized(&s.admin, &game, &true);

    let price_before = s.client.get_share_price();

    // 200 profit, 10% performance fee -> 180 net credited to equity.
    s.client.record_game_pnl(&game, &200, &true);

    let price_after = s.client.get_share_price();
    assert!(price_after > price_before);
    assert_eq!(s.client.get_total_tvl(), 1_180);
    assert_eq!(s.client.get_admin_fees(), 20);

    // The provider's shares now redeem for more than their original
    // deposit.
    s.client.request_withdraw(&provider, &1_000);
    assert_eq!(s.client.get_shares(&provider), 0);
}

#[test]
fn test_withdrawal_lockup_window_prevents_instant_withdrawal() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    s.client.request_withdraw(&provider, &400);

    let err = s.client.try_claim_withdraw(&provider).unwrap_err().unwrap();
    assert_eq!(err, Error::LockupNotExpired);

    s.env.ledger().with_mut(|l| {
        l.sequence_number += WITHDRAW_LOCKUP_LEDGERS;
    });
    let claimed = s.client.claim_withdraw(&provider);
    assert_eq!(claimed, 400);
    assert_eq!(s.token.balance(&provider), 400);
}

#[test]
fn test_unauthorized_game_cannot_record_pnl() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    let unauthorized_game = Address::generate(&s.env);
    let err = s
        .client
        .try_record_game_pnl(&unauthorized_game, &100, &true)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_game_loss_decreases_equity() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    let game = Address::generate(&s.env);
    s.client.set_game_authorized(&s.admin, &game, &true);

    s.client.record_game_pnl(&game, &300, &false);
    assert_eq!(s.client.get_total_tvl(), 700);
}

#[test]
fn test_loss_exceeding_equity_rejected() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    let game = Address::generate(&s.env);
    s.client.set_game_authorized(&s.admin, &game, &true);

    let err = s
        .client
        .try_record_game_pnl(&game, &2_000, &false)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InsufficientEquity);
}

#[test]
fn test_double_pending_withdraw_rejected() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    s.client.request_withdraw(&provider, &200);
    let err = s
        .client
        .try_request_withdraw(&provider, &100)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::WithdrawAlreadyPending);
}

#[test]
fn test_withdraw_more_than_shares_rejected() {
    let s = setup();
    let provider = Address::generate(&s.env);
    fund(&s, &provider, 1_000);
    s.client.deposit_liquidity(&provider, &1_000);

    let err = s
        .client
        .try_request_withdraw(&provider, &1_001)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InsufficientShares);
}
