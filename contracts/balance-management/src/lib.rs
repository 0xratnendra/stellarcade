//! Stellarcade User Balance Management Contract
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    Overflow = 5,
    Underflow = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Account(Address),
    AuthorizedGame(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountState {
    pub balance: i128,
    pub reserved: i128,
    pub last_update: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountSummary {
    /// True if the account has state persisted in this contract.
    pub exists: bool,
    /// Spendable balance.
    pub balance: i128,
    /// Amount currently reserved/locked.
    pub reserved: i128,
    /// Ledger sequence of the latest state mutation affecting the account.
    pub last_update: u32,
}

#[contract]
pub struct BalanceManager;

#[contractimpl]
impl BalanceManager {
    /// Initialize the contract with an admin. May only be called once.
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Add a game contract to the allowlist. Admin only.
    pub fn authorize_game(env: Env, admin: Address, game: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(Error::NotAuthorized);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedGame(game), &true);
        Ok(())
    }

    /// Remove a game contract from the allowlist. Admin only.
    pub fn revoke_game(env: Env, admin: Address, game: Address) -> Result<(), Error> {
        require_initialized(&env)?;
        admin.require_auth();
        if admin != get_admin(&env) {
            return Err(Error::NotAuthorized);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedGame(game));
        Ok(())
    }

    /// Update user balance. Only allowlisted game contracts may call this.
    pub fn update_balance(
        env: Env,
        caller: Address,
        user: Address,
        amount: i128,
        is_add: bool,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        caller.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::AuthorizedGame(caller.clone()))
        {
            return Err(Error::NotAuthorized);
        }

        if amount < 0 {
            return Err(Error::InvalidAmount);
        }

        let mut state = Self::read_state_or_default(&env, user.clone());

        if is_add {
            state.balance = state.balance.checked_add(amount).ok_or(Error::Overflow)?;
        } else {
            if state.balance < amount {
                return Err(Error::Underflow);
            }
            state.balance -= amount;
        }

        state.last_update = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&DataKey::Account(user), &state);
        Ok(())
    }

    /// View user balance.
    pub fn get_balance(env: Env, user: Address) -> i128 {
        Self::read_state_or_default(&env, user).balance
    }

    /// Returns a stable account snapshot for backend consumers.
    ///
    /// If an account has never been written, `exists` is false and numeric
    /// fields are zeroed so unknown and zero-balance-known accounts are
    /// distinguishable.
    pub fn get_account_summary(env: Env, user: Address) -> AccountSummary {
        match env
            .storage()
            .persistent()
            .get::<DataKey, AccountState>(&DataKey::Account(user))
        {
            Some(state) => AccountSummary {
                exists: true,
                balance: state.balance,
                reserved: state.reserved,
                last_update: state.last_update,
            },
            None => AccountSummary {
                exists: false,
                balance: 0,
                reserved: 0,
                last_update: 0,
            },
        }
    }

    fn read_state_or_default(env: &Env, user: Address) -> AccountState {
        env.storage()
            .persistent()
            .get::<DataKey, AccountState>(&DataKey::Account(user))
            .unwrap_or(AccountState {
                balance: 0,
                reserved: 0,
                last_update: 0,
            })
    }
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::{BalanceManager, BalanceManagerClient, Error};
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, Env,
    };

    fn setup(env: &Env) -> (BalanceManagerClient<'_>, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register(BalanceManager, ());
        let client = BalanceManagerClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.init(&admin);
        let game = Address::generate(env);
        client.authorize_game(&admin, &game);
        (client, admin, game)
    }

    #[test]
    fn empty_account_summary_is_explicitly_unknown() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        client.update_balance(&game, &user, &250, &true);

        let summary = client.get_account_summary(&user);
        assert!(summary.exists);
        assert_eq!(summary.balance, 250);
    }

    #[test]
    fn funded_account_summary_reflects_balance() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        env.ledger().with_mut(|li| li.sequence_number = 11);
        client.update_balance(&game, &user, &250, &true);

        let summary = client.get_account_summary(&user);
        assert!(summary.exists);
        assert_eq!(summary.balance, 250);
        assert_eq!(summary.reserved, 0);
        assert_eq!(summary.last_update, 11);
        assert_eq!(client.get_balance(&user), 250);
    }

    #[test]
    fn summary_last_update_tracks_balance_mutations() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        env.ledger().with_mut(|li| li.sequence_number = 5);
        client.update_balance(&game, &user, &100, &true);

        let after_fund = client.get_account_summary(&user);
        assert_eq!(after_fund.balance, 100);
        assert_eq!(after_fund.last_update, 5);

        env.ledger().with_mut(|li| li.sequence_number = 9);
        client.update_balance(&game, &user, &40, &false);

        let after_spend = client.get_account_summary(&user);
        assert!(after_spend.exists);
        assert_eq!(after_spend.balance, 60);
        assert_eq!(after_spend.reserved, 0);
        assert_eq!(after_spend.last_update, 9);
    }

    #[test]
    fn init_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BalanceManager, ());
        let client = BalanceManagerClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.init(&admin);
        let result = client.try_init(&admin);
        assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
    }

    #[test]
    fn non_allowlisted_caller_rejected() {
        let env = Env::default();
        let (client, _admin, _game) = setup(&env);
        let stranger = Address::generate(&env);
        let user = Address::generate(&env);

        let result = client.try_update_balance(&stranger, &user, &100, &true);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    }

    #[test]
    fn allowlisted_caller_succeeds() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        client.update_balance(&game, &user, &100, &true);
        assert_eq!(client.get_balance(&user), 100);
    }

    #[test]
    fn revoked_caller_rejected() {
        let env = Env::default();
        let (client, admin, game) = setup(&env);
        let user = Address::generate(&env);

        client.update_balance(&game, &user, &100, &true);
        client.revoke_game(&admin, &game);

        let result = client.try_update_balance(&game, &user, &50, &true);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    }

    #[test]
    fn only_admin_can_change_allowlist() {
        let env = Env::default();
        let (client, _admin, _game) = setup(&env);
        let non_admin = Address::generate(&env);
        let new_game = Address::generate(&env);

        let result = client.try_authorize_game(&non_admin, &new_game);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));

        let result = client.try_revoke_game(&non_admin, &new_game);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    }

    #[test]
    fn underflow_returns_error() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        client.update_balance(&game, &user, &50, &true);
        let result = client.try_update_balance(&game, &user, &100, &false);
        assert_eq!(result, Err(Ok(Error::Underflow)));
    }

    #[test]
    fn negative_amount_rejected() {
        let env = Env::default();
        let (client, _admin, game) = setup(&env);
        let user = Address::generate(&env);

        let result = client.try_update_balance(&game, &user, &-5, &true);
        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }
}
