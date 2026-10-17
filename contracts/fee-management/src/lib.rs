//! Stellarcade Fee Management Contract
//!
//! Comprehensive fee management system for games and platform operations.
//! Handles fee configuration, collection, accrual, and withdrawal with
//! proper authorization and validation.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient, vec,
    Address, Env, Symbol, Vec,
};

use shared::{calculate_fee, BASIS_POINTS_DIVISOR};

pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidAmount = 4,
    InsufficientFees = 5,
    InvalidFeeConfig = 6,
    GameNotFound = 7,
    Overflow = 8,
    ContractPaused = 9,
    AlreadyPaused = 10,
    NotPaused = 11,
    InvalidRecipient = 12,
    DuplicateOperation = 13,
}

#[contractevent]
pub struct FeeConfigSet {
    pub game_id: Symbol,
    pub fee_bps: u32,
    pub recipient: Address,
    pub admin: Address,
}

#[contractevent]
pub struct FeeCharged {
    pub game_id: Symbol,
    pub amount: i128,
    pub fee_amount: i128,
    pub net_amount: i128,
}

#[contractevent]
pub struct FeesWithdrawn {
    pub game_id: Symbol,
    pub amount: i128,
    pub recipient: Address,
}

#[contractevent]
pub struct ContractInitialized {
    pub admin: Address,
    pub treasury_contract: Address,
}

#[contractevent]
pub struct ContractPaused {
    pub admin: Address,
}

#[contractevent]
pub struct ContractUnpaused {
    pub admin: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    TreasuryContract,
    Paused,
    FeeConfig(Symbol),
    AccruedFees(Symbol),
    ProcessedCharge(ChargeOp),
}

#[contracttype]
#[derive(Clone)]
pub struct FeeConfig {
    pub fee_bps: u32,
    pub recipient: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct ChargeOp {
    pub game_id: Symbol,
    pub amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct FeeState {
    pub total_accrued: i128,
    pub total_withdrawn: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct RouteAllocationSnapshot {
    pub game_id: Symbol,
    pub exists: bool,
    pub total_allocated: i128,
    pub routes: Vec<RouteAllocation>,
}

#[contracttype]
#[derive(Clone)]
pub struct RouteAllocation {
    pub recipient: Address,
    pub percentage: u32,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct FallbackPolicy {
    pub game_id: Symbol,
    pub exists: bool,
    pub fallback_recipient: Address,
    pub fallback_percentage: u32,
}

#[contract]
pub struct FeeManagerContract;

#[contractimpl]
impl FeeManagerContract {
    /// Initialize the fee management contract
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `admin` - The admin address with full control
    /// * `treasury_contract` - The treasury contract address
    pub fn init(env: Env, admin: Address, treasury_contract: Address) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        // Store initial state
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::TreasuryContract, &treasury_contract);
        env.storage().instance().set(&DataKey::Paused, &false);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        ContractInitialized {
            admin: admin.clone(),
            treasury_contract: treasury_contract.clone(),
        }
        .publish(&env);

        Ok(())
    }

    /// Set fee configuration for a game
    pub fn set_fee_config(
        env: Env,
        admin: Address,
        game_id: Symbol,
        bps: u32,
        recipient: Address,
    ) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        // Check authorization
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        // Validate fee configuration
        if bps > BASIS_POINTS_DIVISOR {
            return Err(Error::InvalidFeeConfig);
        }

        // Create and store fee config
        let config = FeeConfig {
            fee_bps: bps,
            recipient: recipient.clone(),
        };
        env.storage()
            .instance()
            .set(&DataKey::FeeConfig(game_id.clone()), &config);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        FeeConfigSet {
            game_id,
            fee_bps: bps,
            recipient,
            admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Charge fee for a game transaction
    pub fn charge_fee(
        env: Env,
        game_id: Symbol,
        amount: i128,
        token: Option<Address>,
    ) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }

        // Validate amount
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Get fee configuration
        let config: FeeConfig = match env
            .storage()
            .instance()
            .get(&DataKey::FeeConfig(game_id.clone()))
        {
            Some(config) => config,
            None => return Err(Error::GameNotFound),
        };

        // Calculate fee
        let fee_amount = match calculate_fee(amount, config.fee_bps) {
            Ok(fee) => fee,
            Err(_) => return Err(Error::Overflow),
        };

        // Create charge operation ID for duplicate prevention
        let charge_op = ChargeOp {
            game_id: game_id.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };

        // Check for duplicate operations
        if env
            .storage()
            .instance()
            .has(&DataKey::ProcessedCharge(charge_op.clone()))
        {
            return Err(Error::DuplicateOperation);
        }

        // Mark as processed
        env.storage()
            .instance()
            .set(&DataKey::ProcessedCharge(charge_op), &true);

        // Update accrued fees
        let current_fees = env
            .storage()
            .instance()
            .get(&DataKey::AccruedFees(game_id.clone()))
            .unwrap_or(0i128);

        let new_fees = match current_fees.checked_add(fee_amount) {
            Some(fees) => fees,
            None => return Err(Error::Overflow),
        };

        env.storage()
            .instance()
            .set(&DataKey::AccruedFees(game_id.clone()), &new_fees);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        FeeCharged {
            game_id: game_id.clone(),
            amount,
            fee_amount,
            net_amount: amount - fee_amount,
        }
        .publish(&env);

        // If token is provided, transfer fee to recipient
        if let Some(token_address) = token {
            let token_client = TokenClient::new(&env, &token_address);
            let contract_address = env.current_contract_address();

            // This assumes the caller has already transferred the full amount to this contract
            // The contract then transfers the fee to the recipient
            token_client.transfer(&contract_address, &config.recipient, &fee_amount);
        }

        Ok(amount - fee_amount)
    }

    /// Get accrued fees for a game
    pub fn accrued_fees(env: Env, game_id: Symbol) -> Result<i128, Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        let fees = env
            .storage()
            .instance()
            .get(&DataKey::AccruedFees(game_id))
            .unwrap_or(0i128);

        Ok(fees)
    }

    /// Withdraw accrued fees for a game
    pub fn withdraw_fees(
        env: Env,
        admin: Address,
        game_id: Symbol,
        recipient: Option<Address>,
        amount: Option<i128>,
    ) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }

        // Check authorization
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        // Get fee configuration
        let config: FeeConfig = match env
            .storage()
            .instance()
            .get(&DataKey::FeeConfig(game_id.clone()))
        {
            Some(config) => config,
            None => return Err(Error::GameNotFound),
        };

        // Get current accrued fees
        let current_fees = env
            .storage()
            .instance()
            .get(&DataKey::AccruedFees(game_id.clone()))
            .unwrap_or(0i128);

        if current_fees <= 0 {
            return Err(Error::InsufficientFees);
        }

        // Determine withdrawal amount
        let withdraw_amount = match amount {
            Some(amt) => {
                if amt <= 0 || amt > current_fees {
                    return Err(Error::InvalidAmount);
                }
                amt
            }
            None => current_fees,
        };

        // Determine recipient
        let final_recipient = match recipient {
            Some(addr) => addr,
            None => config.recipient.clone(),
        };

        // Update accrued fees
        let remaining_fees = current_fees - withdraw_amount;
        env.storage()
            .instance()
            .set(&DataKey::AccruedFees(game_id.clone()), &remaining_fees);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        FeesWithdrawn {
            game_id,
            amount: withdraw_amount,
            recipient: final_recipient,
        }
        .publish(&env);

        Ok(())
    }

    /// Pause the contract (admin only)
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        // Check authorization
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        // Check if already paused
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::AlreadyPaused);
        }

        // Set paused state
        env.storage().instance().set(&DataKey::Paused, &true);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        ContractPaused { admin }.publish(&env);

        Ok(())
    }

    /// Unpause the contract (admin only)
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }

        // Check authorization
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if stored_admin != admin {
            return Err(Error::NotAuthorized);
        }

        // Check if not paused
        if !env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::NotPaused);
        }

        // Set unpaused state
        env.storage().instance().set(&DataKey::Paused, &false);

        // Bump storage
        env.storage()
            .instance()
            .extend_ttl(PERSISTENT_BUMP_LEDGERS, PERSISTENT_BUMP_LEDGERS);

        // Emit event
        ContractUnpaused { admin }.publish(&env);

        Ok(())
    }

    /// Get route allocation snapshot for a game
    pub fn route_allocation_snapshot(env: Env, game_id: Symbol) -> RouteAllocationSnapshot {
        match env
            .storage()
            .instance()
            .get::<_, FeeConfig>(&DataKey::FeeConfig(game_id.clone()))
        {
            Some(config) => {
                let accrued = env
                    .storage()
                    .instance()
                    .get::<_, i128>(&DataKey::AccruedFees(game_id.clone()))
                    .unwrap_or(0i128);

                RouteAllocationSnapshot {
                    game_id,
                    exists: true,
                    total_allocated: accrued,
                    routes: vec![
                        &env,
                        RouteAllocation {
                            recipient: config.recipient,
                            percentage: 10000, // 100% in basis points
                            amount: accrued,
                        },
                    ],
                }
            }
            None => RouteAllocationSnapshot {
                game_id,
                exists: false,
                total_allocated: 0,
                routes: vec![&env],
            },
        }
    }

    /// Get fallback policy for a game
    pub fn fallback_policy(env: Env, game_id: Symbol) -> FallbackPolicy {
        match env
            .storage()
            .instance()
            .get::<_, FeeConfig>(&DataKey::FeeConfig(game_id.clone()))
        {
            Some(config) => FallbackPolicy {
                game_id,
                exists: true,
                fallback_recipient: config.recipient,
                fallback_percentage: 10000, // 100% in basis points
            },
            None => FallbackPolicy {
                game_id,
                exists: false,
                fallback_recipient: env.current_contract_address(),
                fallback_percentage: 0,
            },
        }
    }
}

#[cfg(test)]
mod tests;
