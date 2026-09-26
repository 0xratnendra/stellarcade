//! NFT access pass gatekeeper (experimental).
//!
//! Issues short-lived, single-use access tickets to players holding at least
//! one token from the authorized NFT collection. Tickets are consumed on entry
//! to restricted VIP tournaments and stop validating once the NFT leaves the
//! player's wallet.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Bytes, Env, BytesN};

pub use types::{AccessPass, Error, PASS_TTL_LEDGERS};
use types::DataKey;

#[contract]
pub struct NftAccessPass;

#[contractimpl]
impl NftAccessPass {
    /// Register the admin and the authorized NFT collection contract.
    pub fn initialize(env: Env, admin: Address, nft_contract: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if nft_contract == env.current_contract_address() {
            return Err(Error::InvalidNftContract);
        }
        storage::set_admin(&env, &admin);
        storage::set_nft_contract(&env, &nft_contract);
        env.storage().instance().set(&DataKey::Nonce, &0u64);
        Ok(())
    }

    /// Verify the player holds at least one NFT from the authorized collection
    /// and issue a unique, short-lived access ticket.
    pub fn verify_and_issue_pass(env: Env, player: Address) -> Result<BytesN<32>, Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let nft_contract = storage::get_nft_contract(&env);
        let balance = token::Client::new(&env, &nft_contract).balance(&player);
        if balance < 1 {
            return Err(Error::NoNftBalance);
        }

        let nonce: u64 = env.storage().instance().get(&DataKey::Nonce).unwrap_or(0);
        env.storage().instance().set(&DataKey::Nonce, &(nonce + 1));

        // Unique ticket id: SHA256(nonce || ledger).
        let mut buf = Bytes::new(&env);
        buf.extend_from_slice(&nonce.to_be_bytes());
        buf.extend_from_slice(&env.ledger().sequence().to_be_bytes());        let ticket_id: BytesN<32> = env.crypto().sha256(&buf).into();
        let pass = AccessPass {
            ticket_id: ticket_id.clone(),
            player: player.clone(),
            expires_at_ledger: env.ledger().sequence() + PASS_TTL_LEDGERS,
            used: false,
            revoked: false,
        };
        storage::save_pass(&env, &ticket_id, &pass);
        Ok(ticket_id)
    }

    /// Validate a ticket for `player`. Returns false (instead of erroring) for
    /// every invalid state so callers can gate entry with a single bool:
    /// unknown ticket, wrong owner, already used, expired, revoked, or the
    /// NFT having been transferred out of the wallet since issuance.
    pub fn validate_pass(env: Env, player: Address, ticket_id: BytesN<32>) -> bool {
        if storage::require_initialized(&env).is_err() {
            return false;
        }
        let mut pass = match storage::load_pass(&env, &ticket_id) {
            Ok(pass) => pass,
            Err(_) => return false,
        };
        if pass.player != player || pass.used || pass.revoked {
            return false;
        }
        if env.ledger().sequence() >= pass.expires_at_ledger {
            return false;
        }

        // Revocation-on-transfer: the ticket dies with the NFT balance. A
        // player whose badge was moved away no longer validates.
        let nft_contract = storage::get_nft_contract(&env);
        if token::Client::new(&env, &nft_contract).balance(&player) < 1 {
            pass.revoked = true;
            storage::save_pass(&env, &ticket_id, &pass);
            return false;
        }
        true
    }

    /// Consume a ticket on entry to a restricted VIP tournament. Single use:
    /// the second consume attempt fails with `PassAlreadyUsed`.
    pub fn consume_pass(env: Env, player: Address, ticket_id: BytesN<32>) -> Result<(), Error> {
        storage::require_initialized(&env)?;
        player.require_auth();

        let mut pass = storage::load_pass(&env, &ticket_id)?;
        if pass.player != player {
            return Err(Error::Unauthorized);
        }
        if pass.used {
            return Err(Error::PassAlreadyUsed);
        }
        if pass.revoked {
            return Err(Error::PassRevoked);
        }
        if env.ledger().sequence() >= pass.expires_at_ledger {
            return Err(Error::PassExpired);
        }
        if token::Client::new(&env, &storage::get_nft_contract(&env)).balance(&player) < 1 {
            pass.revoked = true;
            storage::save_pass(&env, &ticket_id, &pass);
            return Err(Error::PassRevoked);
        }

        pass.used = true;
        storage::save_pass(&env, &ticket_id, &pass);
        Ok(())
    }

    /// Read-only access to a ticket's state (operators / tests).
    pub fn get_pass(env: Env, ticket_id: BytesN<32>) -> Result<AccessPass, Error> {
        storage::load_pass(&env, &ticket_id)
    }
}
