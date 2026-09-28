//! Coin Flip Verifiable
//!
//! An isolated 1v1 coin flip escrow contract. Player 1 opens a game
//! calling a side (heads or tails) and locking a wager alongside a
//! commitment to a secret salt; player 2 joins, matching the wager and
//! committing their own secret salt. Once both have revealed, the
//! outcome is derived by XORing the two revealed salts together —
//! neither player alone controls the result, since each committed to
//! their salt before seeing the other's.
//!
//! ## Commit-reveal
//!
//! Each player commits `sha256(secret_salt || player_address_xdr)`,
//! binding the commitment to the specific committing player's own
//! address — not just the secret — so a player cannot copy the other's
//! on-chain commitment hash verbatim and later reveal the same secret:
//! their own commitment would need `their_own_address` baked in, which a
//! copied hash wouldn't produce, so `reveal_seed`'s hash check fails for
//! the copier, not the honest original committer.
//!
//! ## Outcome derivation
//!
//! Once both salts are revealed, the contract XORs them byte-for-byte
//! and reads the parity of the first byte of the result: even means
//! `Heads`, odd means `Tails`. Since salts are committed to before
//! either player has seen the other's, neither can bias this outcome
//! toward their own called side after the fact. Player 1 wins if the
//! derived outcome matches their `choice`; player 2 (implicitly the
//! opposite side) wins otherwise.
//!
//! ## Timeout protection
//!
//! Once both players have joined and committed, a `reveal_deadline` is
//! set (`REVEAL_WINDOW_SECONDS` from that moment). If one player reveals
//! and the other stalls past the deadline, the honest revealer may call
//! `claim_timeout` to sweep the full pot uncontested — no house fee is
//! taken on a timeout claim, since it's a penalty against the
//! non-revealing counterparty, not a normal resolution.
//!
//! ## Storage strategy
//! - `instance()`: `Config` (admin, token, house fee) and a game counter.
//! - `persistent()`: `Game(id)`, bumped on every write.
#![no_std]
#![allow(unexpected_cfgs)]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, Bytes, BytesN, Env};

pub use types::{CoinSide, Config, Error, Game, GameStatus};
use types::{
    GameCreated, GameJoined, GameSettled, SeedRevealed, BPS_DENOMINATOR, REVEAL_WINDOW_SECONDS,
};

#[contract]
pub struct CoinFlipVerifiable;

#[contractimpl]
impl CoinFlipVerifiable {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    pub fn initialize(env: Env, admin: Address, token: Address, fee_bps: u32) -> Result<(), Error> {
        admin.require_auth();

        if storage::has_config(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps as i128 > BPS_DENOMINATOR {
            return Err(Error::InvalidInput);
        }

        storage::set_config(
            &env,
            &Config {
                admin,
                token,
                fee_bps,
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // create_game
    // -----------------------------------------------------------------------

    pub fn create_game(
        env: Env,
        player: Address,
        wager: i128,
        commit_hash: BytesN<32>,
        choice: CoinSide,
    ) -> Result<u64, Error> {
        player.require_auth();

        if wager <= 0 {
            return Err(Error::InvalidInput);
        }

        let config = storage::get_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &wager);

        let id = storage::next_game_id(&env);
        let game = Game {
            id,
            player1: player.clone(),
            player2: None,
            wager,
            choice,
            commit1: commit_hash,
            commit2: None,
            salt1: None,
            salt2: None,
            status: GameStatus::Pending,
            reveal_deadline: None,
        };
        storage::set_game(&env, &game);

        GameCreated {
            game_id: id,
            player1: player,
            wager,
        }
        .publish(&env);

        Ok(id)
    }

    // -----------------------------------------------------------------------
    // join_game
    // -----------------------------------------------------------------------

    pub fn join_game(
        env: Env,
        player: Address,
        game_id: u64,
        commit_hash: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let mut game = storage::get_game(&env, game_id)?;
        if game.status != GameStatus::Pending {
            return Err(Error::WrongGameState);
        }
        if player == game.player1 {
            return Err(Error::InvalidInput);
        }

        let config = storage::get_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&player, &contract_address, &game.wager);

        game.player2 = Some(player.clone());
        game.commit2 = Some(commit_hash);
        game.status = GameStatus::Revealing;
        game.reveal_deadline = Some(env.ledger().timestamp() + REVEAL_WINDOW_SECONDS);
        storage::set_game(&env, &game);

        GameJoined {
            game_id,
            player2: player,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // reveal_seed
    // -----------------------------------------------------------------------

    /// Reveal a previously committed secret salt. Verifies
    /// `sha256(secret_salt || player_address_xdr)` matches the player's
    /// own stored commitment. Once both players have revealed, settles
    /// the game immediately.
    pub fn reveal_seed(
        env: Env,
        player: Address,
        game_id: u64,
        secret_salt: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let mut game = storage::get_game(&env, game_id)?;
        if game.status != GameStatus::Revealing {
            return Err(Error::WrongGameState);
        }

        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);
        if !is_player1 && !is_player2 {
            return Err(Error::NotAParticipant);
        }

        let commitment = if is_player1 {
            game.commit1.clone()
        } else {
            game.commit2.clone().ok_or(Error::NotFound)?
        };
        let already_revealed = if is_player1 {
            game.salt1.is_some()
        } else {
            game.salt2.is_some()
        };
        if already_revealed {
            return Err(Error::AlreadyRevealed);
        }

        let expected = commitment_hash(&env, &secret_salt, &player);
        if expected != commitment {
            return Err(Error::CommitmentMismatch);
        }

        if is_player1 {
            game.salt1 = Some(secret_salt);
        } else {
            game.salt2 = Some(secret_salt);
        }
        storage::set_game(&env, &game);

        SeedRevealed {
            game_id,
            player: player.clone(),
        }
        .publish(&env);

        if let (Some(salt1), Some(salt2)) = (game.salt1.clone(), game.salt2.clone()) {
            Self::resolve(&env, game_id, &salt1, &salt2)?;
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // claim_timeout
    // -----------------------------------------------------------------------

    /// If one player has revealed and the other has stalled past the
    /// reveal deadline, the honest revealer sweeps the full pot — no
    /// house fee, since this is a penalty against the non-revealing
    /// counterparty rather than a normal resolution.
    pub fn claim_timeout(env: Env, player: Address, game_id: u64) -> Result<i128, Error> {
        player.require_auth();

        let mut game = storage::get_game(&env, game_id)?;
        if game.status != GameStatus::Revealing {
            return Err(Error::WrongGameState);
        }

        let deadline = game.reveal_deadline.ok_or(Error::TimeoutNotReached)?;
        if env.ledger().timestamp() < deadline {
            return Err(Error::TimeoutNotReached);
        }

        let is_player1 = player == game.player1;
        let is_player2 = game.player2.as_ref() == Some(&player);
        if !is_player1 && !is_player2 {
            return Err(Error::NotAParticipant);
        }

        let (claimant_revealed, counterparty_revealed) = if is_player1 {
            (game.salt1.is_some(), game.salt2.is_some())
        } else {
            (game.salt2.is_some(), game.salt1.is_some())
        };

        if !claimant_revealed {
            return Err(Error::NoRevealYet);
        }
        if counterparty_revealed {
            // Both revealed — this should already be Settled via
            // reveal_seed's auto-resolution, but guard against it anyway.
            return Err(Error::CounterpartyAlreadyRevealed);
        }

        game.status = GameStatus::Settled;
        let pot = game.wager * 2;
        storage::set_game(&env, &game);

        let config = storage::get_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &player, &pot);

        GameSettled {
            game_id,
            winner: player,
            payout: pot,
            via_timeout: true,
        }
        .publish(&env);

        Ok(pot)
    }

    // -----------------------------------------------------------------------
    // read helpers
    // -----------------------------------------------------------------------

    pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error> {
        storage::get_game(&env, game_id)
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        storage::get_config(&env)
    }
}

impl CoinFlipVerifiable {
    fn resolve(
        env: &Env,
        game_id: u64,
        salt1: &BytesN<32>,
        salt2: &BytesN<32>,
    ) -> Result<(), Error> {
        let mut game = storage::get_game(env, game_id)?;

        let outcome = derive_outcome(salt1, salt2);
        let winner = if outcome == game.choice {
            game.player1.clone()
        } else {
            game.player2.clone().ok_or(Error::NotFound)?
        };

        game.status = GameStatus::Settled;
        let pot = game.wager * 2;
        let config = storage::get_config(env)?;
        let fee = (pot * config.fee_bps as i128) / BPS_DENOMINATOR;
        let payout = pot - fee;
        storage::set_game(env, &game);

        let token_client = token::Client::new(env, &config.token);
        let contract_address = env.current_contract_address();
        token_client.transfer(&contract_address, &winner, &payout);
        if fee > 0 {
            token_client.transfer(&contract_address, &config.admin, &fee);
        }

        GameSettled {
            game_id,
            winner,
            payout,
            via_timeout: false,
        }
        .publish(env);

        Ok(())
    }
}

/// `sha256(secret_salt || player_address_xdr)`, binding a commitment to
/// the specific committing player.
fn commitment_hash(env: &Env, secret_salt: &BytesN<32>, player: &Address) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, &secret_salt.to_array());
    preimage.append(&player.clone().to_xdr(env));
    env.crypto().sha256(&preimage).into()
}

/// XORs the two revealed salts byte-for-byte and reads the parity of the
/// first byte: even -> `Heads`, odd -> `Tails`. Deterministic given both
/// salts, and unbiasable by either party alone since both committed
/// before either had seen the other's salt.
fn derive_outcome(salt1: &BytesN<32>, salt2: &BytesN<32>) -> CoinSide {
    let a = salt1.to_array();
    let b = salt2.to_array();
    let xored_first_byte = a[0] ^ b[0];
    if xored_first_byte.is_multiple_of(2) {
        CoinSide::Heads
    } else {
        CoinSide::Tails
    }
}
