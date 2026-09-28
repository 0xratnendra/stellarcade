#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::types::Error;
use crate::{BadgeSoulboundNft, BadgeSoulboundNftClient};

struct Setup {
    env: Env,
    client: BadgeSoulboundNftClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(BadgeSoulboundNft, ());
    let client = BadgeSoulboundNftClient::new(&env, &contract_id);

    let name = String::from_str(&env, "Arcade Ranks");
    let symbol = String::from_str(&env, "RANK");
    client.initialize(&admin, &name, &symbol);

    Setup { env, client, admin }
}

fn uri(env: &Env) -> String {
    String::from_str(env, "ipfs://badge-metadata")
}

#[test]
fn test_mint_assigns_ownership() {
    let s = setup();
    let player = Address::generate(&s.env);

    s.client.mint(&s.admin, &player, &1, &uri(&s.env));

    assert!(s.client.has_badge(&player, &1));
    let badge = s.client.get_badge(&player, &1);
    assert_eq!(badge.metadata_uri, uri(&s.env));
}

#[test]
fn test_transfer_attempt_fails_with_not_transferable() {
    let s = setup();
    let player = Address::generate(&s.env);
    let other = Address::generate(&s.env);
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));

    let err = s
        .client
        .try_transfer(&player, &other, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotTransferable);

    // Ownership is unchanged.
    assert!(s.client.has_badge(&player, &1));
    assert!(!s.client.has_badge(&other, &1));
}

#[test]
fn test_burning_badge_removes_ownership() {
    let s = setup();
    let player = Address::generate(&s.env);
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));
    assert!(s.client.has_badge(&player, &1));

    s.client.burn(&player, &1);

    assert!(!s.client.has_badge(&player, &1));
}

#[test]
fn test_non_admin_cannot_mint() {
    let s = setup();
    let impostor = Address::generate(&s.env);
    let player = Address::generate(&s.env);

    let err = s
        .client
        .try_mint(&impostor, &player, &1, &uri(&s.env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_double_mint_same_badge_rejected() {
    let s = setup();
    let player = Address::generate(&s.env);
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));

    let err = s
        .client
        .try_mint(&s.admin, &player, &1, &uri(&s.env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::BadgeAlreadyMinted);
}

#[test]
fn test_burn_by_non_owner_rejected() {
    let s = setup();
    let player = Address::generate(&s.env);
    let other = Address::generate(&s.env);
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));

    // `other` never held badge 1, so burning it as `other` fails to find it.
    let err = s.client.try_burn(&other, &1).unwrap_err().unwrap();
    assert_eq!(err, Error::BadgeNotFound);
    assert!(s.client.has_badge(&player, &1));
}

#[test]
fn test_can_remint_after_burn() {
    let s = setup();
    let player = Address::generate(&s.env);
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));
    s.client.burn(&player, &1);

    // Burning freed the slot back up.
    s.client.mint(&s.admin, &player, &1, &uri(&s.env));
    assert!(s.client.has_badge(&player, &1));
}
