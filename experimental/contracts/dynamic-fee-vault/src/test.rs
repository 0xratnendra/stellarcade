#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::{DynamicFeeVault, DynamicFeeVaultClient};
use crate::types::{Error, MIN_FEE_BPS, WINDOW_LEDGERS};

const TIER_BRONZE: i128 = 50_000_000_000;
const TIER_SILVER: i128 = 500_000_000_000;
const FEE_UNIT: i128 = 1_000_000;

struct Setup {
    env: Env,
    client: DynamicFeeVaultClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(DynamicFeeVault, ());
    let client = DynamicFeeVaultClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address());

    Setup {
        token: token::Client::new(&env, &sac.address()),
        token_admin: token::StellarAssetClient::new(&env, &sac.address()),
        env,
        client,
        admin,
    }
}

#[test]
fn test_volume_accumulation_upgrades_fee_tier() {
    let s = setup();
    let player = Address::generate(&s.env);

    assert_eq!(s.client.get_fee_bps_for_player(&player), 200);
    s.client.record_volume(&player, &(TIER_BRONZE - FEE_UNIT));
    assert_eq!(s.client.get_fee_bps_for_player(&player), 200);

    // Crossing the Bronze threshold upgrades the tier.
    s.client.record_volume(&player, &FEE_UNIT);
    assert_eq!(s.client.get_fee_bps_for_player(&player), 150);

    s.client.record_volume(&player, &TIER_SILVER);
    assert_eq!(s.client.get_fee_bps_for_player(&player), 100);
}

#[test]
fn test_high_volume_player_gets_lower_fee_bps() {
    let s = setup();
    let whale = Address::generate(&s.env);
    let rookie = Address::generate(&s.env);

    s.client.record_volume(&whale, &TIER_SILVER);

    assert!(
        s.client.get_fee_bps_for_player(&whale) < s.client.get_fee_bps_for_player(&rookie),
        "high-volume player must pay a lower fee"
    );
}

#[test]
fn test_fee_never_drops_below_floor() {
    // Even Gold tier (50 bps) stays above the 25 bps floor; the floor is
    // exercised directly through the shared tier helper.
    assert_eq!(
        crate::fee_bps_for_volume(i128::MAX).max(MIN_FEE_BPS),
        crate::fee_bps_for_volume(i128::MAX)
    );
    assert!(crate::fee_bps_for_volume(i128::MAX) >= MIN_FEE_BPS);
}

#[test]
fn test_rolling_window_decay_resets_expired_volume() {
    let s = setup();
    let player = Address::generate(&s.env);

    s.client.record_volume(&player, &TIER_SILVER);
    assert_eq!(s.client.get_fee_bps_for_player(&player), 100);

    // Advance past the rolling window: volume decays to zero, tier resets.
    s.env.ledger().with_mut(|l| {
        l.sequence_number += WINDOW_LEDGERS;
    });
    assert_eq!(s.client.get_fee_bps_for_player(&player), 200);
}

#[test]
fn test_unauthorized_fee_withdrawal_rejected() {
    let s = setup();
    let impostor = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);

    // Fees exist in the vault…
    let payer = Address::generate(&s.env);
    s.token_admin.mint(&payer, &FEE_UNIT);
    s.client.collect_fee(&payer, &FEE_UNIT);

    // …but a non-admin cannot withdraw them.
    let result = s.client.try_withdraw_fees(&impostor, &recipient);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_admin_withdraws_accumulated_fees() {
    let s = setup();
    let payer = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);

    s.token_admin.mint(&payer, &(FEE_UNIT * 2));
    s.client.collect_fee(&payer, &FEE_UNIT);
    s.client.collect_fee(&payer, &FEE_UNIT);
    assert_eq!(s.client.get_fees_collected(), FEE_UNIT * 2);

    let withdrawn = s.client.withdraw_fees(&s.admin, &recipient);
    assert_eq!(withdrawn, FEE_UNIT * 2);
    assert_eq!(s.token.balance(&recipient), FEE_UNIT * 2);
    assert_eq!(s.client.get_fees_collected(), 0);
}

#[test]
fn test_withdrawal_with_empty_vault_rejected() {
    let s = setup();
    let recipient = Address::generate(&s.env);
    let result = s.client.try_withdraw_fees(&s.admin, &recipient);
    assert_eq!(result, Err(Ok(Error::InsufficientFees)));
}

#[test]
fn test_record_volume_rejects_non_positive_amounts() {
    let s = setup();
    let player = Address::generate(&s.env);
    let result = s.client.try_record_volume(&player, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_initialize_twice_fails() {
    let s = setup();
    let result = s.client.try_initialize(&s.admin, &s.token.address);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
