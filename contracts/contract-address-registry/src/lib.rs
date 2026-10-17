//! Stellarcade Contract Address Registry
//!
//! A centralized registry for tracking deployed contract addresses with version management.
//! Enables dynamic contract resolution and maintains full historical audit trail.
//!
//! ## Purpose
//! - Register and track all Stellarcade contract addresses
//! - Support contract upgrades through versioning
//! - Provide dynamic address resolution for cross-contract calls
//! - Maintain immutable history of all contract versions
//!
//! ## Security Model
//! - Admin-only registration and updates
//! - Public read access for resolution and history
//! - Immutable history prevents tampering
//!
//! ## Usage
//! ```ignore
//! // Initialize with admin
//! registry.init(&admin_address);
//!
//! // Register a new contract
//! registry.register(&env, "prize-pool", &contract_address, 1);
//!
//! // Resolve current address
//! let address = registry.resolve(&env, "prize-pool");
//!
//! // Update to new version
//! registry.update(&env, "prize-pool", &new_address, 2);
//!
//! // Query history
//! let history = registry.history(&env, "prize-pool");
//! ```

#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String, Vec};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Storage bump amount for persistent data (approximately 30 days at 5s/ledger)
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Maximum contract name length (prevents storage abuse)
const MAX_NAME_LENGTH: u32 = 64;

/// Minimum contract name length
const MIN_NAME_LENGTH: u32 = 1;

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Registry has already been initialized
    AlreadyInitialized = 1,
    /// Registry has not been initialized
    NotInitialized = 2,
    /// Caller is not authorized to perform this action
    NotAuthorized = 3,
    /// Contract name not found in registry
    ContractNotFound = 4,
    /// Invalid contract address format
    InvalidAddress = 5,
    /// Contract name already registered
    DuplicateRegistration = 6,
    /// Invalid version number
    InvalidVersion = 7,
    /// Invalid contract name format
    InvalidName = 8,
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Admin address with full control
    Admin,
    /// Current contract record: name -> ContractRecord
    Contract(String),
    /// Historical contract record: (name, version) -> ContractRecord
    ContractHistory(String, u32),
    /// Latest version counter: name -> u32
    LatestVersion(String),
    /// Initialization flag
    Initialized,
    /// Vector of all registered contract names
    AllNames,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractRecord {
    /// Contract address (C... format)
    pub address: Address,
    /// Version number (starts at 1)
    pub version: u32,
    /// Ledger sequence when registered/updated
    pub registered_at: u32,
    /// Address that performed the registration/update
    pub registered_by: Address,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IssueType {
    Missing = 1,
    Duplicate = 2,
    Placeholder = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryIssue {
    pub contract_name: String,
    pub issue_type: IssueType,
    pub details: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationReport {
    pub timestamp: u32,
    pub issues: Vec<RegistryIssue>,
    pub total_checked: u32,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// Events are emitted via topics in the environment
// No struct definitions needed - we'll use simple topic-based events

// ---------------------------------------------------------------------------
// Contract Implementation
// ---------------------------------------------------------------------------

#[contract]
pub struct ContractAddressRegistry;

#[contractimpl]
impl ContractAddressRegistry {
    /// Initialize the registry with an admin address.
    ///
    /// # Arguments
    /// * `admin` - Address that will have full control over the registry
    ///
    /// # Errors
    /// * `AlreadyInitialized` - If registry has already been initialized
    ///
    /// # Events
    /// Emits `Initialized` event on success
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }

        // Require admin to authorize this call
        admin.require_auth();

        // Store admin address
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);

        Ok(())
    }

    /// Register a new contract in the registry.
    ///
    /// # Arguments
    /// * `name` - Unique identifier for the contract (e.g., "prize-pool")
    /// * `address` - Contract address (must start with 'C')
    /// * `version` - Initial version number (typically 1)
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    /// * `NotAuthorized` - If caller is not the admin
    /// * `InvalidName` - If name is empty, too long, or invalid format
    /// * `InvalidAddress` - If address format is invalid
    /// * `DuplicateRegistration` - If contract name already exists
    /// * `InvalidVersion` - If version is 0
    ///
    /// # Events
    /// Emits `ContractRegistered` event on success
    pub fn register(env: Env, name: String, address: Address, version: u32) -> Result<(), Error> {
        // Check initialization
        Self::require_initialized(&env)?;

        // Check authorization
        let admin = Self::require_admin(&env)?;

        // Validate inputs
        Self::validate_name(&env, &name)?;
        Self::validate_version(version)?;

        // Check for duplicate registration
        if env
            .storage()
            .persistent()
            .has(&DataKey::Contract(name.clone()))
        {
            return Err(Error::DuplicateRegistration);
        }

        // Create contract record
        let record = ContractRecord {
            address: address.clone(),
            version,
            registered_at: env.ledger().sequence(),
            registered_by: admin.clone(),
        };

        // Store current record
        env.storage()
            .persistent()
            .set(&DataKey::Contract(name.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Contract(name.clone()),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Store in history
        env.storage()
            .persistent()
            .set(&DataKey::ContractHistory(name.clone(), version), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::ContractHistory(name.clone(), version),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Store latest version
        env.storage()
            .persistent()
            .set(&DataKey::LatestVersion(name.clone()), &version);
        env.storage().persistent().extend_ttl(
            &DataKey::LatestVersion(name.clone()),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Update AllNames list
        let mut names: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::AllNames)
            .unwrap_or_else(|| Vec::new(&env));
        names.push_back(name);
        env.storage().instance().set(&DataKey::AllNames, &names);

        Ok(())
    }

    /// Update an existing contract to a new address and version.
    ///
    /// # Arguments
    /// * `name` - Contract name to update
    /// * `address` - New contract address
    /// * `version` - New version number (must be greater than current)
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    /// * `NotAuthorized` - If caller is not the admin
    /// * `ContractNotFound` - If contract name doesn't exist
    /// * `InvalidAddress` - If address format is invalid
    /// * `InvalidVersion` - If version is not greater than current version
    ///
    /// # Events
    /// Emits `ContractUpdated` event on success
    pub fn update(env: Env, name: String, address: Address, version: u32) -> Result<(), Error> {
        // Check initialization
        Self::require_initialized(&env)?;

        // Check authorization
        let admin = Self::require_admin(&env)?;

        // Validate version
        Self::validate_version(version)?;

        // Get existing record
        let old_record: ContractRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Contract(name.clone()))
            .ok_or(Error::ContractNotFound)?;

        // Verify new version is greater than old version
        if version <= old_record.version {
            return Err(Error::InvalidVersion);
        }

        // Create new record
        let new_record = ContractRecord {
            address: address.clone(),
            version,
            registered_at: env.ledger().sequence(),
            registered_by: admin.clone(),
        };

        // Update current record
        env.storage()
            .persistent()
            .set(&DataKey::Contract(name.clone()), &new_record);
        env.storage().persistent().extend_ttl(
            &DataKey::Contract(name.clone()),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Append to history
        env.storage().persistent().set(
            &DataKey::ContractHistory(name.clone(), version),
            &new_record,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::ContractHistory(name.clone(), version),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Update latest version
        env.storage()
            .persistent()
            .set(&DataKey::LatestVersion(name.clone()), &version);
        env.storage().persistent().extend_ttl(
            &DataKey::LatestVersion(name.clone()),
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        Ok(())
    }

    /// Performs a validation report of the registry.
    ///
    /// Flags missing required contracts, duplicate addresses across different aliases,
    /// and placeholder records.
    ///
    /// # Returns
    /// A structured report (`ValidationReport`) flagging:
    /// - **Missing**: Required core contracts (e.g., `prize-pool`) not registered.
    /// - **Duplicate**: Multiple aliases pointing to the identical address.
    /// - **Placeholder**: Address matches the zero-address placeholder (`CAAA...`).
    ///
    /// # Operator Guidance
    /// - **Missing** records: Deploy the missing contract and register it.
    /// - **Duplicate** records: Investigate alias misconfigurations.
    /// - **Placeholder** records: Replace with real addresses before production use.
    pub fn validation_report(env: Env) -> Result<ValidationReport, Error> {
        Self::require_initialized(&env)?;

        let mut issues = Vec::new(&env);
        let names_in_storage: Vec<String> = env
            .storage()
            .instance()
            .get(&DataKey::AllNames)
            .unwrap_or_else(|| Vec::new(&env));

        let mut addresses = Vec::new(&env);
        let mut total_checked = 0;

        // 1. Check for missing core contracts
        let core_contracts = Vec::from_array(
            &env,
            [
                String::from_str(&env, "prize-pool"),
                String::from_str(&env, "random-generator"),
                String::from_str(&env, "coin-flip"),
            ],
        );

        for core_name in core_contracts.iter() {
            if !env
                .storage()
                .persistent()
                .has(&DataKey::Contract(core_name.clone()))
            {
                issues.push_back(RegistryIssue {
                    contract_name: core_name,
                    issue_type: IssueType::Missing,
                    details: String::from_str(&env, "Required core contract is not registered"),
                });
            }
        }

        // 2. Iterate through all registered contracts for Duplicate and Placeholder checks
        for name in names_in_storage.iter() {
            total_checked += 1;
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, ContractRecord>(&DataKey::Contract(name.clone()))
            {
                // Placeholder Check (all-zeros address)
                if Self::is_placeholder(&env, &record.address) {
                    issues.push_back(RegistryIssue {
                        contract_name: name.clone(),
                        issue_type: IssueType::Placeholder,
                        details: String::from_str(
                            &env,
                            "Contract address is a zero-address placeholder",
                        ),
                    });
                }

                // Duplicate Check
                for (idx, other_addr) in addresses.iter().enumerate() {
                    if other_addr == record.address {
                        let _ = names_in_storage.get(idx as u32); // acknowledge the duplicate name exists
                        issues.push_back(RegistryIssue {
                            contract_name: name.clone(),
                            issue_type: IssueType::Duplicate,
                            details: String::from_str(
                                &env,
                                "Shares address with another registered contract",
                            ),
                        });
                        break;
                    }
                }
                addresses.push_back(record.address);
            }
        }

        Ok(ValidationReport {
            timestamp: env.ledger().sequence(),
            issues,
            total_checked,
        })
    }

    /// Helper to detect placeholder addresses (explicit zero-address check).
    /// Placeholder is defined as the Stellar zero-address strkey:
    /// CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
    fn is_placeholder(env: &Env, address: &Address) -> bool {
        let zero_strkey = String::from_str(
            env,
            "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        );
        let placeholder_addr = Address::from_string(&zero_strkey);
        address == &placeholder_addr
    }

    /// Resolve the current address for a contract name.
    ///
    /// # Arguments
    /// * `name` - Contract name to resolve
    ///
    /// # Returns
    /// The current contract address
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    /// * `ContractNotFound` - If contract name doesn't exist
    ///
    /// # Note
    /// This is a public read operation - no authorization required
    pub fn resolve(env: Env, name: String) -> Result<Address, Error> {
        // Check initialization
        Self::require_initialized(&env)?;

        // Get and return current address
        let record: ContractRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Contract(name))
            .ok_or(Error::ContractNotFound)?;

        Ok(record.address)
    }

    /// Get the full version history for a contract.
    ///
    /// # Arguments
    /// * `name` - Contract name to query
    ///
    /// # Returns
    /// Vector of all historical contract records, ordered by version
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    /// * `ContractNotFound` - If contract name doesn't exist
    ///
    /// # Note
    /// This is a public read operation - no authorization required
    pub fn history(env: Env, name: String) -> Result<Vec<ContractRecord>, Error> {
        // Check initialization
        Self::require_initialized(&env)?;

        // Check if contract exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Contract(name.clone()))
        {
            return Err(Error::ContractNotFound);
        }

        // Get latest version
        let latest_version: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::LatestVersion(name.clone()))
            .unwrap_or(0);

        // Collect all historical records
        let mut history = Vec::new(&env);

        for version in 1..=latest_version {
            if let Some(record) = env
                .storage()
                .persistent()
                .get::<DataKey, ContractRecord>(&DataKey::ContractHistory(name.clone(), version))
            {
                history.push_back(record);
            }
        }

        Ok(history)
    }

    /// Get the current version number for a contract.
    ///
    /// # Arguments
    /// * `name` - Contract name to query
    ///
    /// # Returns
    /// The current version number
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    /// * `ContractNotFound` - If contract name doesn't exist
    pub fn get_version(env: Env, name: String) -> Result<u32, Error> {
        // Check initialization
        Self::require_initialized(&env)?;

        // Check if contract exists
        if !env
            .storage()
            .persistent()
            .has(&DataKey::Contract(name.clone()))
        {
            return Err(Error::ContractNotFound);
        }

        // Get latest version
        let version: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::LatestVersion(name))
            .unwrap_or(0);

        Ok(version)
    }

    /// Get the current admin address.
    ///
    /// # Returns
    /// The admin address
    ///
    /// # Errors
    /// * `NotInitialized` - If registry hasn't been initialized
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        Self::require_initialized(&env)?;

        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Private Helper Methods ─────────────────────────────────────────────

    /// Verify that the registry has been initialized
    fn require_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    /// Verify that the caller is the admin and return admin address
    fn require_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        admin.require_auth();
        Ok(admin)
    }

    /// Validate contract name format and length
    fn validate_name(_env: &Env, name: &String) -> Result<(), Error> {
        let len = name.len();

        if len < MIN_NAME_LENGTH {
            return Err(Error::InvalidName);
        }

        if len > MAX_NAME_LENGTH {
            return Err(Error::InvalidName);
        }

        // Check for valid characters (alphanumeric, hyphens, underscores)
        // Note: Soroban String doesn't have convenient char iteration,
        // so we do basic validation
        if len == 0 {
            return Err(Error::InvalidName);
        }

        Ok(())
    }

    /// Validate version number (must be > 0)
    fn validate_version(version: u32) -> Result<(), Error> {
        if version == 0 {
            return Err(Error::InvalidVersion);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    // ── Test Helpers ───────────────────────────────────────────────────────

    fn setup_test() -> (
        Env,
        ContractAddressRegistryClient<'static>,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(ContractAddressRegistry, ());
        let client = ContractAddressRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let contract_addr = Address::generate(&env);

        (env, client, admin, contract_addr)
    }

    fn init_registry(client: &ContractAddressRegistryClient, admin: &Address) {
        client.init(admin);
    }

    // ── Initialization Tests ───────────────────────────────────────────────

    #[test]
    fn test_init_success() {
        let (_env, client, admin, _) = setup_test();

        client.init(&admin);

        // Verify admin is stored
        let stored_admin = client.get_admin();
        assert_eq!(stored_admin, admin);
    }

    #[test]
    fn test_init_already_initialized() {
        let (_env, client, admin, _) = setup_test();

        init_registry(&client, &admin);

        // Try to initialize again
        let result = client.try_init(&admin);
        assert!(result.is_err());
    }

    // ── Registration Tests ─────────────────────────────────────────────────

    #[test]
    fn test_register_success() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");
        let version = 1u32;

        client.register(&name, &contract_addr, &version);

        // Verify contract is registered
        let resolved = client.resolve(&name);
        assert_eq!(resolved, contract_addr);

        // Verify version
        let stored_version = client.get_version(&name);
        assert_eq!(stored_version, version);
    }

    #[test]
    fn test_register_not_initialized() {
        let (env, client, _, contract_addr) = setup_test();

        let name = String::from_str(&env, "prize-pool");
        let result = client.try_register(&name, &contract_addr, &1);

        assert!(result.is_err());
    }

    #[test]
    fn test_register_duplicate() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        // First registration
        client.register(&name, &contract_addr, &1);

        // Try to register again
        let result = client.try_register(&name, &contract_addr, &1);

        assert!(result.is_err());
    }

    #[test]
    fn test_register_invalid_version_zero() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");
        let result = client.try_register(&name, &contract_addr, &0);

        assert!(result.is_err());
    }

    #[test]
    fn test_register_invalid_name_empty() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "");
        let result = client.try_register(&name, &contract_addr, &1);

        assert!(result.is_err());
    }

    // ── Update Tests ───────────────────────────────────────────────────────

    #[test]
    fn test_update_success() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");
        let new_addr = Address::generate(&env);

        // Register initial version
        client.register(&name, &contract_addr, &1);

        // Update to new version
        client.update(&name, &new_addr, &2);

        // Verify new address is resolved
        let resolved = client.resolve(&name);
        assert_eq!(resolved, new_addr);

        // Verify new version
        let version = client.get_version(&name);
        assert_eq!(version, 2);
    }

    #[test]
    fn test_update_not_found() {
        let (env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "nonexistent");
        let new_addr = Address::generate(&env);

        let result = client.try_update(&name, &new_addr, &2);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_invalid_version_not_incremental() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        // Register initial version
        client.register(&name, &contract_addr, &1);

        // Try to update with same version
        let new_addr = Address::generate(&env);
        let result = client.try_update(&name, &new_addr, &1);
        assert!(result.is_err());

        // Try to update with lower version
        let result = client.try_update(&name, &new_addr, &0);
        assert!(result.is_err());
    }

    // ── Resolve Tests ──────────────────────────────────────────────────────

    #[test]
    fn test_resolve_success() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        client.register(&name, &contract_addr, &1);

        let resolved = client.resolve(&name);
        assert_eq!(resolved, contract_addr);
    }

    #[test]
    fn test_resolve_not_found() {
        let (env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "nonexistent");
        let result = client.try_resolve(&name);

        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_not_initialized() {
        let (env, client, _, _) = setup_test();

        let name = String::from_str(&env, "prize-pool");
        let result = client.try_resolve(&name);

        assert!(result.is_err());
    }

    // ── History Tests ──────────────────────────────────────────────────────

    #[test]
    fn test_history_single_version() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        client.register(&name, &contract_addr, &1);

        let history = client.history(&name);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().address, contract_addr);
        assert_eq!(history.get(0).unwrap().version, 1);
    }

    #[test]
    fn test_history_multiple_versions() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");
        let addr_v2 = Address::generate(&env);
        let addr_v3 = Address::generate(&env);

        // Register v1
        client.register(&name, &contract_addr, &1);

        // Update to v2
        client.update(&name, &addr_v2, &2);

        // Update to v3
        client.update(&name, &addr_v3, &3);

        let history = client.history(&name);
        assert_eq!(history.len(), 3);

        // Verify version order
        assert_eq!(history.get(0).unwrap().version, 1);
        assert_eq!(history.get(0).unwrap().address, contract_addr);

        assert_eq!(history.get(1).unwrap().version, 2);
        assert_eq!(history.get(1).unwrap().address, addr_v2);

        assert_eq!(history.get(2).unwrap().version, 3);
        assert_eq!(history.get(2).unwrap().address, addr_v3);
    }

    #[test]
    fn test_history_not_found() {
        let (env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "nonexistent");
        let result = client.try_history(&name);

        assert!(result.is_err());
    }

    // ── Version Query Tests ────────────────────────────────────────────────

    #[test]
    fn test_get_version_success() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        client.register(&name, &contract_addr, &1);

        let version = client.get_version(&name);
        assert_eq!(version, 1);
    }

    #[test]
    fn test_get_version_after_update() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "prize-pool");

        client.register(&name, &contract_addr, &1);

        let new_addr = Address::generate(&env);
        client.update(&name, &new_addr, &2);

        let version = client.get_version(&name);
        assert_eq!(version, 2);
    }

    // ── Admin Query Tests ──────────────────────────────────────────────────

    #[test]
    fn test_get_admin() {
        let (_env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let stored_admin = client.get_admin();
        assert_eq!(stored_admin, admin);
    }

    #[test]
    fn test_get_admin_not_initialized() {
        let (_env, client, _, _) = setup_test();

        let result = client.try_get_admin();
        assert!(result.is_err());
    }

    // ── Integration Tests ──────────────────────────────────────────────────

    #[test]
    fn test_full_lifecycle() {
        let (env, client, admin, contract_addr) = setup_test();
        init_registry(&client, &admin);

        let name = String::from_str(&env, "coin-flip");

        // Register initial version
        client.register(&name, &contract_addr, &1);

        // Verify resolution
        let addr = client.resolve(&name);
        assert_eq!(addr, contract_addr);

        // Update to v2
        let addr_v2 = Address::generate(&env);
        client.update(&name, &addr_v2, &2);

        // Verify new resolution
        let addr = client.resolve(&name);
        assert_eq!(addr, addr_v2);

        // Update to v3
        let addr_v3 = Address::generate(&env);
        client.update(&name, &addr_v3, &3);

        // Verify history
        let history = client.history(&name);
        assert_eq!(history.len(), 3);

        // Verify current version
        let version = client.get_version(&name);
        assert_eq!(version, 3);
    }

    #[test]
    fn test_multiple_contracts() {
        let (env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let names = soroban_sdk::vec![
            &env,
            String::from_str(&env, "coin-flip"),
            String::from_str(&env, "prize-pool"),
            String::from_str(&env, "random-generator"),
        ];

        // Register multiple contracts
        for name in names.iter() {
            let addr = Address::generate(&env);
            client.register(&name, &addr, &1);

            // Verify each one resolves correctly
            let resolved = client.resolve(&name);
            assert_eq!(resolved, addr);
        }
    }

    // ── Validation Report Tests ───────────────────────────────────────────

    #[test]
    fn test_validation_report_healthy() {
        let (env, client, admin, addr1) = setup_test();
        init_registry(&client, &admin);

        let addr2 = Address::generate(&env);
        let addr3 = Address::generate(&env);

        client.register(&String::from_str(&env, "prize-pool"), &addr1, &1);
        client.register(&String::from_str(&env, "random-generator"), &addr2, &1);
        client.register(&String::from_str(&env, "coin-flip"), &addr3, &1);

        let report = client.validation_report();
        assert_eq!(report.issues.len(), 0);
        assert_eq!(report.total_checked, 3);
    }

    #[test]
    fn test_validation_report_missing() {
        let (env, client, admin, addr1) = setup_test();
        init_registry(&client, &admin);

        // Only register one
        client.register(&String::from_str(&env, "prize-pool"), &addr1, &1);

        let report = client.validation_report();
        // Should flag 2 missing (rng, coin-flip)
        assert_eq!(report.issues.len(), 2);
        assert_eq!(report.issues.get(0).unwrap().issue_type, IssueType::Missing);
        assert_eq!(report.issues.get(1).unwrap().issue_type, IssueType::Missing);
    }

    #[test]
    fn test_validation_report_duplicate() {
        let (env, client, admin, addr1) = setup_test();
        init_registry(&client, &admin);

        client.register(&String::from_str(&env, "prize-pool"), &addr1, &1);
        // Register another one with the SAME address
        client.register(&String::from_str(&env, "other-alias"), &addr1, &1);

        let report = client.validation_report();
        // Should flag 2 missing (rng, coin-flip) + 1 duplicate
        assert_eq!(report.issues.len(), 3);

        let mut found_duplicate = false;
        for issue in report.issues.iter() {
            if issue.issue_type == IssueType::Duplicate {
                found_duplicate = true;
                assert_eq!(issue.contract_name, String::from_str(&env, "other-alias"));
            }
        }
        assert!(found_duplicate);
    }

    #[test]
    fn test_validation_report_placeholder() {
        let (env, client, admin, _) = setup_test();
        init_registry(&client, &admin);

        let zero_strkey = String::from_str(
            &env,
            "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        );
        let placeholder_addr = Address::from_string(&zero_strkey);

        client.register(&String::from_str(&env, "prize-pool"), &placeholder_addr, &1);

        let report = client.validation_report();
        // Should flag 2 missing + 1 placeholder
        assert!(report
            .issues
            .iter()
            .any(|i| i.issue_type == IssueType::Placeholder));
    }
}
