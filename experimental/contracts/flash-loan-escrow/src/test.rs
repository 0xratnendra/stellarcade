#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Address, Env, Val,
    Vec,
};

const FEE_BPS: u32 = 30; // 0.3%

/// A borrower that fully repays, using the escrow address passed via
/// `params[0]` (a `Val`-encoded Address) to know where to send funds back.
#[contract]
struct RepayingBorrower;

#[contractimpl]
impl RepayingBorrower {
    pub fn execute_operation(
        env: Env,
        token: Address,
        amount: i128,
        fee: i128,
        params: Vec<Val>,
    ) -> bool {
        let escrow: Address = params.get(0).unwrap().into_val(&env);
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &escrow, &(amount + fee));
        true
    }
}

/// A borrower that repays only the principal, not the fee (must cause the
/// whole flash_loan call to revert).
#[contract]
struct ShortRepayBorrower;

#[contractimpl]
impl ShortRepayBorrower {
    pub fn execute_operation(
        env: Env,
        token: Address,
        amount: i128,
        _fee: i128,
        params: Vec<Val>,
    ) -> bool {
        let escrow: Address = params.get(0).unwrap().into_val(&env);
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &escrow, &amount); // fee withheld
        true
    }
}

/// A borrower that repays nothing at all.
#[contract]
struct NonRepayingBorrower;

#[contractimpl]
impl NonRepayingBorrower {
    pub fn execute_operation(
        _env: Env,
        _token: Address,
        _amount: i128,
        _fee: i128,
        _params: Vec<Val>,
    ) -> bool {
        true
    }
}

fn setup(env: &Env) -> (FlashLoanEscrowClient<'_>, Address, Address, Address) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(FlashLoanEscrow, ());
    let client = FlashLoanEscrowClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &token_address, &FEE_BPS);

    (client, admin, token_address, contract_id)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. successful flash loan borrow and repayment with fee
// ---------------------------------------------------------------------------

#[test]
fn test_successful_flash_loan_borrow_and_repayment_with_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000_000_000_000);
    client.deposit_liquidity(&provider, &1_000_000_000_000);

    let borrower = env.register(RepayingBorrower, ());
    // Fund the borrower with enough to cover the fee (a real arbitrage bot
    // would generate this from the trade itself; this test isolates the
    // repayment-verification logic from arbitrage profit generation).
    mint(&env, &token_address, &borrower, 10_000_000_000);

    let loan_amount = 100_000_000_000i128;
    let expected_fee = loan_amount * FEE_BPS as i128 / 10_000;

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    let balance_before = tc.balance(&contract_id);

    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    client.flash_loan(&borrower, &token_address, &loan_amount, &params);

    let balance_after = tc.balance(&contract_id);
    assert_eq!(balance_after, balance_before + expected_fee);
}

#[test]
fn test_flash_loan_rejects_amount_exceeding_available_liquidity() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 10_000_000_000);
    client.deposit_liquidity(&provider, &10_000_000_000);

    let borrower = env.register(RepayingBorrower, ());
    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    let result = client.try_flash_loan(&borrower, &token_address, &20_000_000_000, &params);
    assert_eq!(result, Err(Ok(Error::InsufficientLiquidity)));
}

// ---------------------------------------------------------------------------
// 2. transaction reverts when borrower fails to return full amount
// ---------------------------------------------------------------------------

#[test]
fn test_transaction_reverts_when_borrower_repays_principal_but_not_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000_000_000_000);
    client.deposit_liquidity(&provider, &1_000_000_000_000);

    let borrower = env.register(ShortRepayBorrower, ());
    let loan_amount = 100_000_000_000i128;

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    let balance_before = tc.balance(&contract_id);

    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    let result = client.try_flash_loan(&borrower, &token_address, &loan_amount, &params);
    assert_eq!(result, Err(Ok(Error::LoanNotRepaid)));

    // Soroban's all-or-nothing semantics: the escrow's balance must be
    // completely unaffected by the reverted call, not left short by the
    // withheld fee.
    assert_eq!(tc.balance(&contract_id), balance_before);
}

#[test]
fn test_transaction_reverts_when_borrower_repays_nothing() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000_000_000_000);
    client.deposit_liquidity(&provider, &1_000_000_000_000);

    let borrower = env.register(NonRepayingBorrower, ());
    let loan_amount = 100_000_000_000i128;

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    let balance_before = tc.balance(&contract_id);

    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    let result = client.try_flash_loan(&borrower, &token_address, &loan_amount, &params);
    assert_eq!(result, Err(Ok(Error::LoanNotRepaid)));
    assert_eq!(tc.balance(&contract_id), balance_before);
}

// ---------------------------------------------------------------------------
// 3. liquidity provider fee share accrual
// ---------------------------------------------------------------------------

#[test]
fn test_liquidity_provider_fee_share_accrual() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    mint(&env, &token_address, &provider_a, 1_000_000_000_000);
    mint(&env, &token_address, &provider_b, 1_000_000_000_000);
    // 75/25 split of total liquidity.
    client.deposit_liquidity(&provider_a, &750_000_000_000);
    client.deposit_liquidity(&provider_b, &250_000_000_000);

    let borrower = env.register(RepayingBorrower, ());
    mint(&env, &token_address, &borrower, 10_000_000_000);

    let loan_amount = 100_000_000_000i128;
    let expected_fee = loan_amount * FEE_BPS as i128 / 10_000;

    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    client.flash_loan(&borrower, &token_address, &loan_amount, &params);

    let fees_a = client.get_provider_fees_earned(&provider_a);
    let fees_b = client.get_provider_fees_earned(&provider_b);

    assert_eq!(fees_a, expected_fee * 75 / 100);
    assert_eq!(fees_b, expected_fee * 25 / 100);
    assert_eq!(fees_a + fees_b, expected_fee);
}

#[test]
fn test_provider_can_claim_accrued_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000_000_000_000);
    client.deposit_liquidity(&provider, &1_000_000_000_000);

    let borrower = env.register(RepayingBorrower, ());
    mint(&env, &token_address, &borrower, 10_000_000_000);

    let loan_amount = 100_000_000_000i128;
    let expected_fee = loan_amount * FEE_BPS as i128 / 10_000;

    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    client.flash_loan(&borrower, &token_address, &loan_amount, &params);

    let claimed = client.claim_fees(&provider);
    assert_eq!(claimed, expected_fee);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&provider), expected_fee); // provider deposited all their minted balance
    assert_eq!(client.get_provider_fees_earned(&provider), 0);
}

#[test]
fn test_depositing_more_after_a_loan_does_not_retroactively_earn_past_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, contract_id) = setup(&env);

    let early_provider = Address::generate(&env);
    mint(&env, &token_address, &early_provider, 1_000_000_000_000);
    client.deposit_liquidity(&early_provider, &1_000_000_000_000);

    let borrower = env.register(RepayingBorrower, ());
    mint(&env, &token_address, &borrower, 10_000_000_000);
    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    client.flash_loan(&borrower, &token_address, &100_000_000_000, &params);

    // A new provider joins AFTER the loan; they must not retroactively
    // earn a share of a fee accrued before their deposit.
    let late_provider = Address::generate(&env);
    mint(&env, &token_address, &late_provider, 1_000_000_000_000);
    client.deposit_liquidity(&late_provider, &1_000_000_000_000);

    assert_eq!(client.get_provider_fees_earned(&late_provider), 0);
    assert!(client.get_provider_fees_earned(&early_provider) > 0);
}

// ---------------------------------------------------------------------------
// additional coverage
// ---------------------------------------------------------------------------

#[test]
fn test_withdraw_liquidity_rejects_amount_exceeding_principal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 100);
    client.deposit_liquidity(&provider, &100);

    let result = client.try_withdraw_liquidity(&provider, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientLiquidity)));
}

#[test]
fn test_withdraw_liquidity_returns_principal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000);
    client.deposit_liquidity(&provider, &1_000);
    client.withdraw_liquidity(&provider, &400);

    assert_eq!(client.get_provider_principal(&provider), 600);
    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&provider), 400);
}

#[test]
fn test_initialize_rejects_invalid_fee_bps() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let contract_id = env.register(FlashLoanEscrow, ());
    let client = FlashLoanEscrowClient::new(&env, &contract_id);

    assert_eq!(
        client.try_initialize(&admin, &token_address, &0u32),
        Err(Ok(Error::InvalidInput))
    );
    assert_eq!(
        client.try_initialize(&admin, &token_address, &10_001u32),
        Err(Ok(Error::InvalidInput))
    );
}

#[test]
fn test_claim_fees_with_nothing_accrued_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 100);
    client.deposit_liquidity(&provider, &100);

    let result = client.try_claim_fees(&provider);
    assert_eq!(result, Err(Ok(Error::NoDeposit)));
}

#[test]
fn test_set_fee_bps_by_admin_updates_future_loan_fees() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token_address, contract_id) = setup(&env);

    let provider = Address::generate(&env);
    mint(&env, &token_address, &provider, 1_000_000_000_000);
    client.deposit_liquidity(&provider, &1_000_000_000_000);

    client.set_fee_bps(&admin, &100u32); // 1%
    assert_eq!(client.get_fee_bps(), 100);

    let borrower = env.register(RepayingBorrower, ());
    mint(&env, &token_address, &borrower, 10_000_000_000);

    let loan_amount = 100_000_000_000i128;
    let params = soroban_sdk::vec![&env, contract_id.clone().into_val(&env)];
    client.flash_loan(&borrower, &token_address, &loan_amount, &params);

    assert_eq!(
        client.get_provider_fees_earned(&provider),
        loan_amount * 100 / 10_000
    );
}

#[test]
fn test_set_fee_bps_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _contract_id) = setup(&env);

    let not_admin = Address::generate(&env);
    let result = client.try_set_fee_bps(&not_admin, &100u32);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}
