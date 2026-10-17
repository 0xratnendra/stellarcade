use shared::BASIS_POINTS_DIVISOR;
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

use crate::{DataKey, Error, FeeConfig, FeeManagerContract, FeeManagerContractClient};

fn setup_contract() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FeeManagerContract, ());
    let client = FeeManagerContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Initialize contract
    client.init(&admin, &treasury);

    (env, contract_id, admin, treasury)
}

#[test]
fn test_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FeeManagerContract, ());
    let client = FeeManagerContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Successful initialization
    client.init(&admin, &treasury);

    // Check storage
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().instance().get(&DataKey::Admin), Some(admin));
        assert_eq!(
            env.storage().instance().get(&DataKey::TreasuryContract),
            Some(treasury)
        );
        assert_eq!(env.storage().instance().get(&DataKey::Paused), Some(false));
    });
}

#[test]
fn test_init_already_initialized() {
    let (env, contract_id, admin, treasury) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);

    // Try to initialize again
    assert_eq!(
        client.try_init(&admin, &treasury),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn test_set_fee_config() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250; // 2.5%
    let recipient = Address::generate(&env);

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Check storage
    let stored_config: FeeConfig = env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .get(&DataKey::FeeConfig(game_id))
            .unwrap()
    });
    assert_eq!(stored_config.fee_bps, fee_bps);
    assert_eq!(stored_config.recipient, recipient);
}

#[test]
fn test_set_fee_config_unauthorized() {
    let (env, contract_id, _, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    // Try with unauthorized caller
    assert_eq!(
        client.try_set_fee_config(&unauthorized, &game_id, &fee_bps, &recipient),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn test_set_fee_config_invalid_bps() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let recipient = Address::generate(&env);

    // Invalid BPS (too high)
    assert_eq!(
        client.try_set_fee_config(&admin, &game_id, &(BASIS_POINTS_DIVISOR + 1), &recipient),
        Err(Ok(Error::InvalidFeeConfig))
    );
}

#[test]
fn test_charge_fee() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250; // 2.5%
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Charge fee
    let result = client.charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result, 975);

    // Check accrued fees
    let accrued = client.accrued_fees(&game_id);
    assert_eq!(accrued, 25);
}

#[test]
fn test_charge_fee_game_not_found() {
    let (env, contract_id, _, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("nogame");
    let amount = 1000i128;

    let result = client.try_charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result, Err(Ok(Error::GameNotFound)));
}

#[test]
fn test_charge_fee_invalid_amount() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Invalid amount (zero)
    let result = client.try_charge_fee(&game_id, &0i128, &None::<Address>);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));

    // Invalid amount (negative)
    let result = client.try_charge_fee(&game_id, &-100i128, &None::<Address>);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_charge_fee_duplicate_operation() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // First charge should succeed
    let result1 = client.charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result1, 975);

    // Second charge with same parameters should fail (duplicate)
    let result2 = client.try_charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result2, Err(Ok(Error::DuplicateOperation)));
}

#[test]
fn test_accrued_fees() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let amount1 = 1000i128;
    let amount2 = 2000i128;

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Initially no fees
    assert_eq!(client.accrued_fees(&game_id), 0);

    // Charge fees
    client.charge_fee(&game_id, &amount1, &None::<Address>);
    assert_eq!(client.accrued_fees(&game_id), 25); // 2.5% of 1000

    client.charge_fee(&game_id, &amount2, &None::<Address>);
    assert_eq!(client.accrued_fees(&game_id), 75); // 25 + 50
}

#[test]
fn test_withdraw_fees_all() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config and charge fees
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);
    let _result = client.charge_fee(&game_id, &amount, &None::<Address>);

    // Withdraw all fees
    client.withdraw_fees(&admin, &game_id, &None::<Address>, &None::<i128>);

    // Check no fees remaining
    assert_eq!(client.accrued_fees(&game_id), 0);
}

#[test]
fn test_withdraw_fees_partial() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config and charge fees
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);
    client.charge_fee(&game_id, &amount, &None::<Address>);

    // Withdraw partial fees
    let withdraw_amount = 10i128;
    assert_eq!(
        client.try_withdraw_fees(&admin, &game_id, &None::<Address>, &Some(withdraw_amount)),
        Ok(Ok(()))
    );

    // Check remaining fees
    assert_eq!(client.accrued_fees(&game_id), 15); // 25 - 10
}

#[test]
fn test_withdraw_fees_insufficient() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);

    // Set fee config but no fees charged
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Try to withdraw with no fees
    assert_eq!(
        client.try_withdraw_fees(&admin, &game_id, &None::<Address>, &None::<i128>),
        Err(Ok(Error::InsufficientFees))
    );
}

#[test]
fn test_withdraw_fees_invalid_amount() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config and charge fees
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);
    client.charge_fee(&game_id, &amount, &None::<Address>);

    // Try to withdraw more than available
    assert_eq!(
        client.try_withdraw_fees(&admin, &game_id, &None::<Address>, &Some(100i128)),
        Err(Ok(Error::InvalidAmount))
    );

    // Try to withdraw zero
    assert_eq!(
        client.try_withdraw_fees(&admin, &game_id, &None::<Address>, &Some(0i128)),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn test_withdraw_fees_custom_recipient() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    let custom_recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set fee config and charge fees
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);
    client.charge_fee(&game_id, &amount, &None::<Address>);

    // Withdraw to custom recipient
    assert_eq!(
        client.try_withdraw_fees(
            &admin,
            &game_id,
            &Some(custom_recipient.clone()),
            &None::<i128>
        ),
        Ok(Ok(()))
    );
}

#[test]
fn test_pause_unpause() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);

    // Pause contract
    client.pause(&admin);

    // Try to charge fee while paused
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    let result = client.try_charge_fee(&game_id, &1000i128, &None::<Address>);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));

    // Unpause contract
    client.unpause(&admin);

    // Now charging should work
    let result = client.charge_fee(&game_id, &1000i128, &None::<Address>);
    assert_eq!(result, 975);
}

#[test]
fn test_pause_unpause_unauthorized() {
    let (env, contract_id, _, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let unauthorized = Address::generate(&env);

    // Try to pause with unauthorized caller
    assert_eq!(
        client.try_pause(&unauthorized),
        Err(Ok(Error::NotAuthorized))
    );

    // Pause with admin
    let admin: Address = env.as_contract(&contract_id, || {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    });
    client.pause(&admin);

    // Try to unpause with unauthorized caller
    assert_eq!(
        client.try_unpause(&unauthorized),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn test_pause_already_paused() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);

    // Pause contract
    client.pause(&admin);

    // Try to pause again
    assert_eq!(client.try_pause(&admin), Err(Ok(Error::AlreadyPaused)));
}

#[test]
fn test_unpause_not_paused() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);

    // Try to unpause when not paused
    assert_eq!(client.try_unpause(&admin), Err(Ok(Error::NotPaused)));
}

#[test]
fn test_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(FeeManagerContract, ());
    let client = FeeManagerContractClient::new(&env, &contract_id);

    let game_id = symbol_short!("game1");

    // All operations should fail when not initialized
    assert_eq!(
        client.try_set_fee_config(
            &Address::generate(&env),
            &game_id,
            &250u32,
            &Address::generate(&env)
        ),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_charge_fee(&game_id, &1000i128, &None::<Address>),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_accrued_fees(&game_id),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_withdraw_fees(
            &Address::generate(&env),
            &game_id,
            &None::<Address>,
            &None::<i128>
        ),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_pause(&Address::generate(&env)),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_unpause(&Address::generate(&env)),
        Err(Ok(Error::NotInitialized))
    );
}

#[test]
fn test_overflow_protection() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Try with maximum amount that might cause overflow
    let max_amount = i128::MAX;
    let result = client.try_charge_fee(&game_id, &max_amount, &None::<Address>);
    // This should either succeed or fail with Overflow error, not panic
    assert!(matches!(result, Ok(Ok(_)) | Err(Ok(Error::Overflow))));
}

#[test]
fn test_zero_fee_config() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 0; // No fee
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set zero fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Charge fee - should return full amount
    let result = client.charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result, 1000);

    // No fees should be accrued
    assert_eq!(client.accrued_fees(&game_id), 0);
}

#[test]
fn test_maximum_fee_config() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = BASIS_POINTS_DIVISOR; // 100% fee
    let recipient = Address::generate(&env);
    let amount = 1000i128;

    // Set maximum fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Charge fee - should return zero amount (full fee)
    let result = client.charge_fee(&game_id, &amount, &None::<Address>);
    assert_eq!(result, 0);

    // Full amount should be accrued as fees
    assert_eq!(client.accrued_fees(&game_id), 1000);
}

#[test]
fn test_route_allocation_snapshot() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);

    // Test with no config
    let snapshot = client.route_allocation_snapshot(&game_id);
    assert_eq!(snapshot.game_id, game_id);
    assert!(!snapshot.exists);
    assert_eq!(snapshot.total_allocated, 0);
    assert!(snapshot.routes.is_empty());

    // Set fee config and charge fees
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);
    client.charge_fee(&game_id, &1000i128, &None::<Address>);

    // Test with config and fees
    let snapshot = client.route_allocation_snapshot(&game_id);
    assert_eq!(snapshot.game_id, game_id);
    assert!(snapshot.exists);
    assert_eq!(snapshot.total_allocated, 25);
    assert_eq!(snapshot.routes.len(), 1);
    assert_eq!(snapshot.routes.get(0).unwrap().recipient, recipient);
    assert_eq!(snapshot.routes.get(0).unwrap().percentage, 10000);
    assert_eq!(snapshot.routes.get(0).unwrap().amount, 25);
}

#[test]
fn test_fallback_policy() {
    let (env, contract_id, admin, _) = setup_contract();
    let client = FeeManagerContractClient::new(&env, &contract_id);
    let game_id = symbol_short!("game1");
    let fee_bps = 250;
    let recipient = Address::generate(&env);

    // Test with no config
    let policy = client.fallback_policy(&game_id);
    assert_eq!(policy.game_id, game_id);
    assert!(!policy.exists);
    assert_eq!(policy.fallback_percentage, 0);

    // Set fee config
    client.set_fee_config(&admin, &game_id, &fee_bps, &recipient);

    // Test with config
    let policy = client.fallback_policy(&game_id);
    assert_eq!(policy.game_id, game_id);
    assert!(policy.exists);
    assert_eq!(policy.fallback_recipient, recipient);
    assert_eq!(policy.fallback_percentage, 10000);
}
