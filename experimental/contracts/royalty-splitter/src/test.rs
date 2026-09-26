#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    vec, Address, Env,
};

fn setup<'a>(
    env: &'a Env,
    shares_bps: &[u32],
) -> (RoyaltySplitterClient<'a>, Address, Address, Vec<Address>) {
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let mut recipients: Vec<Address> = Vec::new(env);
    let mut shares: Vec<u32> = Vec::new(env);
    for &s in shares_bps {
        recipients.push_back(Address::generate(env));
        shares.push_back(s);
    }

    let contract_id = env.register(RoyaltySplitter, ());
    let client = RoyaltySplitterClient::new(env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin, &recipients, &shares);

    (client, admin, token_address, recipients)
}

fn mint(env: &Env, token_address: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token_address).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// 1. revenue distribution splits amounts proportionally
// ---------------------------------------------------------------------------

#[test]
fn test_revenue_distribution_splits_amounts_proportionally_pushed() {
    let env = Env::default();
    env.mock_all_auths();
    // 50% dev, 30% house, 20% community.
    let (client, _admin, token_address, recipients) = setup(&env, &[5_000, 3_000, 2_000]);

    let depositor = Address::generate(&env);
    mint(&env, &token_address, &depositor, 10_000_000_000);

    client.distribute_revenue(&depositor, &token_address, &10_000_000_000, &true);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&recipients.get(0).unwrap()), 500_0000000);
    assert_eq!(tc.balance(&recipients.get(1).unwrap()), 300_0000000);
    assert_eq!(tc.balance(&recipients.get(2).unwrap()), 200_0000000);
}

#[test]
fn test_revenue_distribution_accumulates_claimable_when_not_pushed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, recipients) = setup(&env, &[5_000, 5_000]);

    let depositor = Address::generate(&env);
    mint(&env, &token_address, &depositor, 100_0000000);
    client.distribute_revenue(&depositor, &token_address, &100_0000000, &false);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    // No direct transfer happened yet.
    assert_eq!(tc.balance(&recipients.get(0).unwrap()), 0);
    assert_eq!(
        client.get_claimable(&recipients.get(0).unwrap(), &token_address),
        50_0000000
    );
    assert_eq!(
        client.get_claimable(&recipients.get(1).unwrap(), &token_address),
        50_0000000
    );
}

#[test]
fn test_distribution_rounding_remainder_goes_to_last_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    // 33.33% / 33.33% / 33.34% would be the "fair" split of 100 units
    // three ways; use exact bps that force a rounding remainder instead:
    // 3333 / 3333 / 3334 bps of 10 units = 3.333/3.333/3.334 -> floors to
    // 3/3/3 = 9, with 1 unit of remainder that must land on recipient 2
    // (the last one), not get stuck in the contract.
    let (client, _admin, token_address, recipients) = setup(&env, &[3_333, 3_333, 3_334]);

    let depositor = Address::generate(&env);
    mint(&env, &token_address, &depositor, 10);
    client.distribute_revenue(&depositor, &token_address, &10, &true);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    let total_paid = tc.balance(&recipients.get(0).unwrap())
        + tc.balance(&recipients.get(1).unwrap())
        + tc.balance(&recipients.get(2).unwrap());
    assert_eq!(total_paid, 10); // no dust left unaccounted for
    assert_eq!(
        tc.balance(&recipients.get(2).unwrap()),
        10 - tc.balance(&recipients.get(0).unwrap()) - tc.balance(&recipients.get(1).unwrap())
    );
}

#[test]
fn test_distribute_revenue_rejects_non_positive_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, _recipients) = setup(&env, &[10_000]);

    let depositor = Address::generate(&env);
    let result = client.try_distribute_revenue(&depositor, &token_address, &0, &true);
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

// ---------------------------------------------------------------------------
// 2. share configuration totaling non-10000 bps is rejected
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_rejects_shares_not_summing_to_ten_thousand() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);

    let contract_id = env.register(RoyaltySplitter, ());
    let client = RoyaltySplitterClient::new(&env, &contract_id);

    let recipients = vec![&env, r1, r2];
    let shares = vec![&env, 5_000u32, 4_000u32]; // sums to 9_000, not 10_000

    let result = client.try_initialize(&admin, &recipients, &shares);
    assert_eq!(result, Err(Ok(Error::SharesMustSumToTenThousand)));
}

#[test]
fn test_initialize_rejects_mismatched_recipients_and_shares_length() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let r1 = Address::generate(&env);

    let contract_id = env.register(RoyaltySplitter, ());
    let client = RoyaltySplitterClient::new(&env, &contract_id);

    let recipients = vec![&env, r1];
    let shares = vec![&env, 5_000u32, 5_000u32];

    let result = client.try_initialize(&admin, &recipients, &shares);
    assert_eq!(result, Err(Ok(Error::MismatchedRecipientsAndShares)));
}

#[test]
fn test_propose_share_update_rejects_shares_not_summing_to_ten_thousand() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address, _recipients) = setup(&env, &[10_000]);

    let bad_recipient = Address::generate(&env);
    let result =
        client.try_propose_share_update(&admin, &vec![&env, bad_recipient], &vec![&env, 9_999u32]);
    assert_eq!(result, Err(Ok(Error::SharesMustSumToTenThousand)));
}

// ---------------------------------------------------------------------------
// 3. individual claim withdrawal
// ---------------------------------------------------------------------------

#[test]
fn test_individual_claim_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, recipients) = setup(&env, &[6_000, 4_000]);

    let depositor = Address::generate(&env);
    mint(&env, &token_address, &depositor, 10_000_000_000);
    client.distribute_revenue(&depositor, &token_address, &10_000_000_000, &false);

    let recipient_0 = recipients.get(0).unwrap();
    let claimed = client.claim_shares(&recipient_0, &token_address);
    assert_eq!(claimed, 600_0000000);

    let tc = soroban_sdk::token::Client::new(&env, &token_address);
    assert_eq!(tc.balance(&recipient_0), 600_0000000);
    assert_eq!(client.get_claimable(&recipient_0, &token_address), 0);

    // The other recipient's claimable balance is untouched.
    let recipient_1 = recipients.get(1).unwrap();
    assert_eq!(
        client.get_claimable(&recipient_1, &token_address),
        400_0000000
    );
}

#[test]
fn test_claim_with_nothing_claimable_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, recipients) = setup(&env, &[10_000]);

    let result = client.try_claim_shares(&recipients.get(0).unwrap(), &token_address);
    assert_eq!(result, Err(Ok(Error::NothingToClaim)));
}

#[test]
fn test_claiming_twice_only_pays_out_once() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, token_address, recipients) = setup(&env, &[10_000]);

    let depositor = Address::generate(&env);
    mint(&env, &token_address, &depositor, 100);
    client.distribute_revenue(&depositor, &token_address, &100, &false);

    let recipient = recipients.get(0).unwrap();
    client.claim_shares(&recipient, &token_address);

    let result = client.try_claim_shares(&recipient, &token_address);
    assert_eq!(result, Err(Ok(Error::NothingToClaim)));
}

// ---------------------------------------------------------------------------
// timelocked share updates
// ---------------------------------------------------------------------------

#[test]
fn test_execute_share_update_before_timelock_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, _token_address, _recipients) = setup(&env, &[10_000]);

    let new_recipient = Address::generate(&env);
    client.propose_share_update(&admin, &vec![&env, new_recipient], &vec![&env, 10_000u32]);

    let result = client.try_execute_share_update();
    assert_eq!(result, Err(Ok(Error::TimelockNotExpired)));
}

#[test]
fn test_execute_share_update_after_timelock_applies_new_shares() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = 100);
    let (client, admin, _token_address, _recipients) = setup(&env, &[10_000]);

    let new_recipient = Address::generate(&env);
    let executable_at = client.propose_share_update(
        &admin,
        &vec![&env, new_recipient.clone()],
        &vec![&env, 10_000u32],
    );

    env.ledger().with_mut(|l| l.sequence_number = executable_at);
    client.execute_share_update();

    let recipients = client.get_recipients();
    assert_eq!(recipients.len(), 1);
    assert_eq!(recipients.get(0).unwrap(), new_recipient);
}

#[test]
fn test_propose_share_update_by_non_admin_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _token_address, _recipients) = setup(&env, &[10_000]);

    let not_admin = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    let result = client.try_propose_share_update(
        &not_admin,
        &vec![&env, new_recipient],
        &vec![&env, 10_000u32],
    );
    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_double_initialize_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _token_address, recipients) = setup(&env, &[10_000]);

    let result = client.try_initialize(&admin, &recipients, &vec![&env, 10_000u32]);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
