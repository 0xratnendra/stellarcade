#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, BytesN, Env,
};

use crate::{NftAccessPass, NftAccessPassClient};
use crate::types::{Error, PASS_TTL_LEDGERS};

struct Setup {
    env: Env,
    client: NftAccessPassClient<'static>,
    nft: token::Client<'static>,
    nft_admin: token::StellarAssetClient<'static>,
    admin: Address,
    player: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let player = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(NftAccessPass, ());
    let client = NftAccessPassClient::new(&env, &contract_id);

    client.initialize(&admin, &sac.address());

    Setup {
        nft: token::Client::new(&env, &sac.address()),
        nft_admin: token::StellarAssetClient::new(&env, &sac.address()),
        env,
        client,
        admin,
        player,
    }
}

#[test]
fn test_player_with_nft_receives_valid_access_ticket() {
    let s = setup();
    s.nft_admin.mint(&s.player, &1);

    let ticket = s.client.verify_and_issue_pass(&s.player);
    assert!(
        s.client.validate_pass(&s.player, &ticket),
        "freshly issued ticket must validate"
    );

    let pass = s.client.get_pass(&ticket);
    assert_eq!(pass.player, s.player);
    assert_eq!(
        pass.expires_at_ledger,
        s.env.ledger().sequence() + PASS_TTL_LEDGERS
    );
}

#[test]
fn test_player_without_nft_is_rejected() {
    let s = setup();
    // No mint for the player.
    let result = s.client.try_verify_and_issue_pass(&s.player);
    assert_eq!(result, Err(Ok(Error::NoNftBalance)));
}

#[test]
fn test_single_use_ticket_cannot_be_reused() {
    let s = setup();
    s.nft_admin.mint(&s.player, &1);

    let ticket = s.client.verify_and_issue_pass(&s.player);
    s.client.consume_pass(&s.player, &ticket);
    assert!(
        !s.client.validate_pass(&s.player, &ticket),
        "consumed ticket must stop validating"
    );

    let result = s.client.try_consume_pass(&s.player, &ticket);
    assert_eq!(result, Err(Ok(Error::PassAlreadyUsed)));
}

#[test]
fn test_pass_is_revoked_when_nft_transfers_out() {
    let s = setup();
    s.nft_admin.mint(&s.player, &1);

    let ticket = s.client.verify_and_issue_pass(&s.player);
    assert!(s.client.validate_pass(&s.player, &ticket));

    let buyer = Address::generate(&s.env);
    s.nft.transfer(&s.player, &buyer, &1);

    assert!(
        !s.client.validate_pass(&s.player, &ticket),
        "ticket must not validate once the NFT left the wallet"
    );
    let result = s.client.try_consume_pass(&s.player, &ticket);
    assert_eq!(result, Err(Ok(Error::PassRevoked)));

    // Ticket stays revoked even if the NFT comes back.
    s.nft.transfer(&buyer, &s.player, &1);
    assert!(!s.client.validate_pass(&s.player, &ticket));
}

#[test]
fn test_ticket_expires_after_ttl() {
    let s = setup();
    s.nft_admin.mint(&s.player, &1);

    let ticket = s.client.verify_and_issue_pass(&s.player);
    s.env.ledger().with_mut(|l| {
        l.sequence_number += PASS_TTL_LEDGERS;
    });
    assert!(
        !s.client.validate_pass(&s.player, &ticket),
        "expired ticket must not validate"
    );
}

#[test]
fn test_ticket_is_bound_to_issuing_player() {
    let s = setup();
    s.nft_admin.mint(&s.player, &1);

    let ticket = s.client.verify_and_issue_pass(&s.player);
    let other = Address::generate(&s.env);
    s.nft_admin.mint(&other, &1);

    assert!(
        !s.client.validate_pass(&other, &ticket),
        "another NFT holder must not use someone else's ticket"
    );
}

#[test]
fn test_initialize_twice_fails() {
    let s = setup();
    let result = s.client.try_initialize(&s.admin, &s.nft.address);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}
