//! Stellarcade Random Generator Contract
//!
//! Provides provably fair, bounded randomness for game contracts via a
//! two-phase request/fulfill model:
//!
//! 1. An authorized game contract calls `request_random`, registering a
//!    pending request with a caller address and an upper bound (`max`).
//! 2. The designated oracle calls `fulfill_random` with a `server_seed`.
//!    The result is computed deterministically as:
//!
//!      `sha256(server_seed || request_id_be_bytes)[0..8] % max`
//!
//!    and stored on-chain alongside the server seed so anyone can verify.
//!
//! ## Fairness Model
//! The oracle must publish `sha256(server_seed)` **before** a game round
//! begins (off-chain commitment). Once a request is submitted, the server
//! seed is fixed — the oracle cannot choose a seed after seeing the
//! request without breaking the pre-published commitment. After fulfillment,
//! any party can re-derive and verify the result using the stored seed:
//!
//!   `sha256(stored_server_seed || request_id_be)[0..8] % max == stored_result`
//!
//! ## Storage Strategy
//! - `instance()`: Admin, Oracle. Fixed contract-level config. TTL is
//!   extended at the start of every state-changing entry point.
//! - `persistent()`: AuthorizedCaller entries, PendingRequest entries,
//!   FulfilledRequest entries (both keyed by `(caller, request_id)`) — each a separate ledger entry with TTL
//!   bumped on every write so active requests never expire mid-game.
#![no_std]
#![allow(unexpected_cfgs)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN,
    Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Persistent storage TTL in ledgers (~30 days at 5 s/ledger).
/// Bumped on every persistent write so no request expires mid-game.
pub const PERSISTENT_BUMP_LEDGERS: u32 = 518_400;

/// Instance storage TTL in ledgers (~30 days at 5 s/ledger). Instance storage
/// holds the admin/oracle config, so if it were archived every call would fail
/// until someone restored it.
pub const INSTANCE_BUMP_LEDGERS: u32 = 518_400;

/// Instance TTL is only extended once it drops below this many ledgers (~15
/// days), so busy contracts do not pay for a bump on every call.
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = 259_200;

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    /// `max < 2` — a range of [0, 0] produces no randomness.
    InvalidBound = 4,
    /// A request with this `request_id` already exists (pending or fulfilled).
    DuplicateRequestId = 5,
    RequestNotFound = 6,
    /// `fulfill_random` was called a second time for the same `request_id`.
    AlreadyFulfilled = 7,
    /// The `caller` passed to `request_random` is not in the whitelist.
    UnauthorizedCaller = 8,
    /// No seed commitments available in the queue.
    NoCommitmentAvailable = 9,
    /// Fulfilled seed hash does not match the bound commitment.
    SeedCommitmentMismatch = 10,
}

// ---------------------------------------------------------------------------
// Storage Types
// ---------------------------------------------------------------------------

/// All storage key discriminants.
///
/// Instance keys (Admin, Oracle): contract config, small fixed set.
/// Persistent keys: per-caller whitelist entries, per-request data.
#[contracttype]
pub enum DataKey {
    // --- instance() ---
    Admin,
    Oracle,
    EntropyMetadata,
    // --- persistent() ---
    /// Presence flag for whitelisted game contract addresses.
    AuthorizedCaller(Address),
    /// A pending randomness request, awaiting oracle fulfillment. Keyed by
    /// `(caller, request_id)` so each authorised game has its own ID space.
    PendingRequest(Address, u64),
    /// A fulfilled request with its result and seed stored for verification.
    /// Keyed by `(caller, request_id)`.
    FulfilledRequest(Address, u64),
    /// Per-requester request counters for sequencing visibility.
    RequesterPendingCount(Address),
    /// Per-requester fulfilled counters for sequencing visibility.
    RequesterFulfilledCount(Address),
    /// FIFO queue of seed commitments pre-committed by the oracle.
    CommitmentQueue,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestState {
    Missing = 0,
    Pending = 1,
    Fulfilled = 2,
}

/// A pending randomness request registered by an authorized game contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingEntry {
    pub caller: Address,
    pub max: u64,
    pub commitment: BytesN<32>,
}

/// A fulfilled request with its deterministic result and the oracle seed.
///
/// Both `server_seed` and `result` are stored on-chain so any external party
/// can verify correctness without trusting the oracle's off-chain claims.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FulfilledEntry {
    pub caller: Address,
    pub max: u64,
    /// Oracle-provided seed; stored to allow on-chain result verification.
    pub server_seed: BytesN<32>,
    /// `sha256(server_seed || request_id_be)[0..8] % max`; always in `[0, max)`.
    pub result: u64,
    pub commitment: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestStatus {
    pub request_id: u64,
    pub state: RequestState,
    pub caller: Option<Address>,
    pub max: Option<u64>,
    pub result: Option<u64>,
    pub server_seed: Option<BytesN<32>>,
    pub commitment: Option<BytesN<32>>,
}

/// Describes the entropy source used by this contract.
///
/// Stored in instance storage so it lives as long as the contract itself.
/// Version metadata is informational — it does not alter randomness output.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntropySourceMetadata {
    /// Semantic version of the entropy source implementation (e.g. "1.0.0").
    pub version: String,
    /// Human-readable description of the entropy source type.
    pub source_type: String,
    /// Hash algorithm used to derive random output.
    pub hash_algorithm: String,
    /// Number of bytes from the hash digest used for the random value.
    pub output_bytes: u32,
}

/// A stable snapshot of the generator's operational configuration.
///
/// Designed for operational tooling to inspect contract settings without
/// side effects. The shape is extensible — new fields can be added in future
/// versions without breaking existing consumers.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GeneratorConfig {
    /// Address of the contract administrator.
    pub admin: Address,
    /// Address of the oracle authorized to fulfill randomness requests.
    pub oracle: Address,
    /// Persistent storage TTL in ledgers.
    pub persistent_ttl: u32,
    /// Minimum allowed value for the `max` parameter in requests.
    pub min_max_bound: u64,
    /// Current entropy metadata version, if set.
    pub entropy_version: Option<String>,
}

/// A per-requester sequencing summary showing their request history.
///
/// Provides deterministic, side-effect-free visibility into how many
/// requests a caller has made and their current state distribution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequesterSummary {
    /// The caller address this summary is for.
    pub caller: Address,
    /// Total number of requests made by this caller (pending + fulfilled).
    pub total_requests: u64,
    /// Number of requests currently pending fulfillment.
    pub pending_count: u64,
    /// Number of requests that have been fulfilled.
    pub fulfilled_count: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct RandomRequested {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub caller: Address,
    pub max: u64,
    pub commitment: BytesN<32>,
}

/// Emits the count of seed commitments appended to the queue.
#[contractevent]
pub struct SeedsCommitted {
    pub count: u32,
}

/// Emits the server_seed so off-chain verifiers do not need a `get_result` call.
#[contractevent]
pub struct RandomFulfilled {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub caller: Address,
    pub result: u64,
    pub server_seed: BytesN<32>,
}

#[contractevent]
pub struct RandomFulfillmentRejected {
    #[topic]
    pub request_id: u64,
    #[topic]
    pub caller: Address,
    pub reason: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct RandomGenerator;

#[contractimpl]
impl RandomGenerator {
    // -----------------------------------------------------------------------
    // init
    // -----------------------------------------------------------------------

    /// Initialize the contract. May only be called once.
    ///
    /// `oracle` is the sole address permitted to call `fulfill_random`. It is
    /// expected to be a backend service that pre-commits server seeds off-chain
    /// before each game round begins.
    pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        extend_instance_ttl(&env);

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // authorize / revoke
    // -----------------------------------------------------------------------

    /// Add a game contract to the caller whitelist. Admin only.
    pub fn authorize(env: Env, admin: Address, caller: Address) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        let key = DataKey::AuthorizedCaller(caller);
        env.storage().persistent().set(&key, &());
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        Ok(())
    }

    /// Remove a game contract from the caller whitelist. Admin only.
    pub fn revoke(env: Env, admin: Address, caller: Address) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedCaller(caller));

        Ok(())
    }

    // -----------------------------------------------------------------------
    // commit_seeds / get_commitment_queue_len
    // -----------------------------------------------------------------------

    /// Commit a batch of oracle seed commitments (sha256 of server seeds) to the FIFO queue.
    /// Oracle only. Returns the new queue length.
    pub fn commit_seeds(
        env: Env,
        oracle: Address,
        commitments: Vec<BytesN<32>>,
    ) -> Result<u32, Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_oracle(&env, &oracle)?;

        let count = commitments.len();
        if count == 0 {
            return Ok(Self::get_commitment_queue_len(env));
        }

        let key = DataKey::CommitmentQueue;
        let mut queue: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        for c in commitments.iter() {
            queue.push_back(c);
        }

        env.storage().persistent().set(&key, &queue);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        SeedsCommitted { count }.publish(&env);

        Ok(queue.len())
    }

    /// Read the number of pending seed commitments available in the queue.
    pub fn get_commitment_queue_len(env: Env) -> u32 {
        let key = DataKey::CommitmentQueue;
        env.storage()
            .persistent()
            .get::<DataKey, Vec<BytesN<32>>>(&key)
            .map(|q| q.len())
            .unwrap_or(0)
    }

    // -----------------------------------------------------------------------
    // request_random
    // -----------------------------------------------------------------------

    /// Submit a randomness request. Only whitelisted callers may call this.
    ///
    /// `max` must be >= 2. The fulfilled result will be in `[0, max - 1]`.
    /// `request_id` must be unique **per caller** — rejected if this caller
    /// already has a pending or fulfilled entry for the same ID. Different
    /// authorised callers may reuse the same ID independently.
    ///
    /// Pops the next commitment from the FIFO queue. If the queue is empty,
    /// fails with `NoCommitmentAvailable`.
    pub fn request_random(
        env: Env,
        caller: Address,
        request_id: u64,
        max: u64,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;

        if max < 2 {
            return Err(Error::InvalidBound);
        }

        caller.require_auth();

        if !env
            .storage()
            .persistent()
            .has(&DataKey::AuthorizedCaller(caller.clone()))
        {
            return Err(Error::UnauthorizedCaller);
        }

        // Block reuse of any request_id by the same caller, pending or
        // fulfilled, to prevent a game contract from submitting a duplicate
        // after its first result. Other callers' IDs are unaffected.
        if env
            .storage()
            .persistent()
            .has(&DataKey::PendingRequest(caller.clone(), request_id))
            || env
                .storage()
                .persistent()
                .has(&DataKey::FulfilledRequest(caller.clone(), request_id))
        {
            return Err(Error::DuplicateRequestId);
        }

        // Pop next commitment from FIFO queue
        let queue_key = DataKey::CommitmentQueue;
        let mut queue: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&queue_key)
            .unwrap_or_else(|| Vec::new(&env));

        if queue.is_empty() {
            return Err(Error::NoCommitmentAvailable);
        }

        let commitment = queue.get(0).unwrap();
        queue.remove(0);
        env.storage().persistent().set(&queue_key, &queue);
        env.storage().persistent().extend_ttl(
            &queue_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        let entry = PendingEntry {
            caller: caller.clone(),
            max,
            commitment: commitment.clone(),
        };
        let key = DataKey::PendingRequest(caller.clone(), request_id);
        env.storage().persistent().set(&key, &entry);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Increment requester's pending count
        let pending_count_key = DataKey::RequesterPendingCount(caller.clone());
        let pending_count: u64 = env
            .storage()
            .persistent()
            .get(&pending_count_key)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&pending_count_key, &(pending_count + 1));
        env.storage().persistent().extend_ttl(
            &pending_count_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        RandomRequested {
            request_id,
            caller,
            max,
            commitment,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // fulfill_random
    // -----------------------------------------------------------------------

    /// Fulfill a pending randomness request. Oracle only.
    ///
    /// The result is derived as:
    ///   `sha256(server_seed || request_id_be_bytes)[0..8] % max`
    ///
    /// Enforces that `sha256(server_seed) == pending.commitment`, proving the seed
    /// was committed on-chain before the request was created.
    /// Both `server_seed`, `commitment` and `result` are persisted for on-chain verification.
    ///
    /// `caller` is the game contract that submitted the request; requests are
    /// namespaced by `(caller, request_id)`. Fulfilling with a caller that did
    /// not submit `request_id` fails with `RequestNotFound`.
    pub fn fulfill_random(
        env: Env,
        oracle: Address,
        caller: Address,
        request_id: u64,
        server_seed: BytesN<32>,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_oracle(&env, &oracle)?;

        // Each (caller, request_id) can be fulfilled exactly once.
        if env
            .storage()
            .persistent()
            .has(&DataKey::FulfilledRequest(caller.clone(), request_id))
        {
            RandomFulfillmentRejected {
                request_id,
                caller: caller.clone(),
                reason: Error::AlreadyFulfilled as u32,
            }
            .publish(&env);
            return Err(Error::AlreadyFulfilled);
        }

        let pending_key = DataKey::PendingRequest(caller.clone(), request_id);
        let pending: PendingEntry =
            env.storage()
                .persistent()
                .get(&pending_key)
                .ok_or_else(|| {
                    RandomFulfillmentRejected {
                        request_id,
                        caller: caller.clone(),
                        reason: Error::RequestNotFound as u32,
                    }
                    .publish(&env);
                    Error::RequestNotFound
                })?;

        // Verify that sha256(server_seed) matches the on-chain commitment bound to this request
        let digest: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_slice(&env, &server_seed.to_array()))
            .into();

        if digest != pending.commitment {
            RandomFulfillmentRejected {
                request_id,
                caller: caller.clone(),
                reason: Error::SeedCommitmentMismatch as u32,
            }
            .publish(&env);
            return Err(Error::SeedCommitmentMismatch);
        }

        let result = derive_result(&env, &server_seed, request_id, pending.max);

        // Remove the pending entry; write the fulfilled entry.
        env.storage().persistent().remove(&pending_key);

        // Decrement requester's pending count
        let pending_count_key = DataKey::RequesterPendingCount(pending.caller.clone());
        let pending_count: u64 = env
            .storage()
            .persistent()
            .get(&pending_count_key)
            .unwrap_or(0);
        if pending_count > 0 {
            env.storage()
                .persistent()
                .set(&pending_count_key, &(pending_count - 1));
        }

        let fulfilled = FulfilledEntry {
            caller: pending.caller.clone(),
            max: pending.max,
            server_seed: server_seed.clone(),
            result,
            commitment: pending.commitment.clone(),
        };
        let fulfilled_key = DataKey::FulfilledRequest(caller.clone(), request_id);
        env.storage().persistent().set(&fulfilled_key, &fulfilled);
        env.storage().persistent().extend_ttl(
            &fulfilled_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        // Increment requester's fulfilled count
        let fulfilled_count_key = DataKey::RequesterFulfilledCount(pending.caller);
        let fulfilled_count: u64 = env
            .storage()
            .persistent()
            .get(&fulfilled_count_key)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&fulfilled_count_key, &(fulfilled_count + 1));
        env.storage().persistent().extend_ttl(
            &fulfilled_count_key,
            PERSISTENT_BUMP_LEDGERS,
            PERSISTENT_BUMP_LEDGERS,
        );

        RandomFulfilled {
            request_id,
            caller,
            result,
            server_seed,
        }
        .publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // get_result
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // entropy metadata
    // -----------------------------------------------------------------------

    /// Set entropy source version metadata. Admin only.
    ///
    /// Metadata is informational and does not affect randomness output.
    pub fn set_entropy_metadata(
        env: Env,
        admin: Address,
        metadata: EntropySourceMetadata,
    ) -> Result<(), Error> {
        extend_instance_ttl(&env);
        require_initialized(&env)?;
        require_admin(&env, &admin)?;

        env.storage()
            .instance()
            .set(&DataKey::EntropyMetadata, &metadata);

        Ok(())
    }

    /// Read the current entropy source version metadata.
    pub fn get_entropy_metadata(env: Env) -> Result<EntropySourceMetadata, Error> {
        require_initialized(&env)?;

        env.storage()
            .instance()
            .get(&DataKey::EntropyMetadata)
            .ok_or(Error::NotInitialized)
    }

    // -----------------------------------------------------------------------
    // get_result
    // -----------------------------------------------------------------------

    /// Return the fulfilled result for `caller`'s `request_id`.
    ///
    /// Returns `RequestNotFound` if the request is still pending, never
    /// existed, or belongs to a different caller.
    pub fn get_result(env: Env, caller: Address, request_id: u64) -> Result<FulfilledEntry, Error> {
        require_initialized(&env)?;

        env.storage()
            .persistent()
            .get(&DataKey::FulfilledRequest(caller, request_id))
            .ok_or(Error::RequestNotFound)
    }

    /// Return the lifecycle status for `caller`'s request id.
    pub fn get_request_status(
        env: Env,
        caller: Address,
        request_id: u64,
    ) -> Result<RequestStatus, Error> {
        require_initialized(&env)?;

        if let Some(entry) = env
            .storage()
            .persistent()
            .get::<DataKey, FulfilledEntry>(&DataKey::FulfilledRequest(caller.clone(), request_id))
        {
            return Ok(RequestStatus {
                request_id,
                state: RequestState::Fulfilled,
                caller: Some(entry.caller),
                max: Some(entry.max),
                result: Some(entry.result),
                server_seed: Some(entry.server_seed),
                commitment: Some(entry.commitment),
            });
        }

        if let Some(entry) = env
            .storage()
            .persistent()
            .get::<DataKey, PendingEntry>(&DataKey::PendingRequest(caller, request_id))
        {
            return Ok(RequestStatus {
                request_id,
                state: RequestState::Pending,
                caller: Some(entry.caller),
                max: Some(entry.max),
                result: None,
                server_seed: None,
                commitment: Some(entry.commitment),
            });
        }

        Ok(RequestStatus {
            request_id,
            state: RequestState::Missing,
            caller: None,
            max: None,
            result: None,
            server_seed: None,
            commitment: None,
        })
    }

    // -----------------------------------------------------------------------
    // get_config
    // -----------------------------------------------------------------------

    /// Return a stable snapshot of the generator's operational configuration.
    ///
    /// This is a read-only, side-effect-free accessor designed for operational
    /// tooling. The config shape is extensible for future generator policy fields.
    pub fn get_config(env: Env) -> Result<GeneratorConfig, Error> {
        require_initialized(&env)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::Oracle)
            .ok_or(Error::NotInitialized)?;

        let entropy_version = env
            .storage()
            .instance()
            .get::<DataKey, EntropySourceMetadata>(&DataKey::EntropyMetadata)
            .map(|m| m.version);

        Ok(GeneratorConfig {
            admin,
            oracle,
            persistent_ttl: PERSISTENT_BUMP_LEDGERS,
            min_max_bound: 2,
            entropy_version,
        })
    }

    // -----------------------------------------------------------------------
    // get_requester_summary
    // -----------------------------------------------------------------------

    /// Return a per-requester sequencing summary showing their request history.
    ///
    /// This is a deterministic, side-effect-free read operation. For missing
    /// requesters (never authorized or no requests), returns a summary with
    /// all counts at zero.
    pub fn get_requester_summary(env: Env, caller: Address) -> RequesterSummary {
        let pending_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::RequesterPendingCount(caller.clone()))
            .unwrap_or(0);

        let fulfilled_count: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::RequesterFulfilledCount(caller.clone()))
            .unwrap_or(0);

        RequesterSummary {
            caller,
            total_requests: pending_count + fulfilled_count,
            pending_count,
            fulfilled_count,
        }
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Keep the instance entry (admin, oracle, metadata) alive. Called first in
/// every state-changing entry point.
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_LEDGERS);
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has(&DataKey::Admin) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != &admin {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

fn require_oracle(env: &Env, caller: &Address) -> Result<(), Error> {
    let oracle: Address = env
        .storage()
        .instance()
        .get(&DataKey::Oracle)
        .ok_or(Error::NotInitialized)?;
    caller.require_auth();
    if caller != &oracle {
        return Err(Error::NotAuthorized);
    }
    Ok(())
}

/// Derive a bounded random result from `server_seed` and `request_id`.
///
/// Constructs a 40-byte preimage:  server_seed (32 bytes) || request_id (8 bytes BE)
/// Takes SHA-256, interprets the first 8 bytes as a big-endian u64, and reduces
/// modulo `max`. Produces a value in `[0, max - 1]`.
///
/// Combining `server_seed` with `request_id` in the preimage ensures that
/// different requests fulfilled with the same seed produce different outputs,
/// preventing the oracle from reusing a single seed commitment across rounds.
fn derive_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
    // Build preimage on the stack to avoid heap allocation.
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&server_seed.to_array());
    preimage[32..].copy_from_slice(&request_id.to_be_bytes());

    let digest: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage))
        .into();
    let arr = digest.to_array();
    let raw = u64::from_be_bytes([
        arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
    ]);
    raw % max
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env, String};

    // ------------------------------------------------------------------
    // Test helpers
    // ------------------------------------------------------------------

    /// Register contract + init. Returns (client, admin, oracle, game_contract).
    fn setup(env: &Env) -> (RandomGeneratorClient<'_>, Address, Address, Address) {
        let admin = Address::generate(env);
        let oracle = Address::generate(env);
        let game = Address::generate(env);

        let contract_id = env.register(RandomGenerator, ());
        let client = RandomGeneratorClient::new(env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &oracle);
        client.authorize(&admin, &game);

        (client, admin, oracle, game)
    }

    /// Re-derive the expected result using the same logic as `derive_result`,
    /// so the test is an independent cross-check of the on-chain computation.
    fn expected_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
        let mut preimage = [0u8; 40];
        preimage[..32].copy_from_slice(&server_seed.to_array());
        preimage[32..].copy_from_slice(&request_id.to_be_bytes());
        let digest: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_slice(env, &preimage))
            .into();
        let arr = digest.to_array();
        let raw = u64::from_be_bytes([
            arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
        ]);
        raw % max
    }

    fn seed(env: &Env, byte: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = byte;
        BytesN::from_array(env, &arr)
    }

    fn commit_seeds_for_test(
        env: &Env,
        client: &RandomGeneratorClient<'_>,
        oracle: &Address,
        seeds: &[BytesN<32>],
    ) {
        let mut commitments = soroban_sdk::Vec::new(env);
        for s in seeds {
            let h: BytesN<32> = env
                .crypto()
                .sha256(&Bytes::from_slice(env, &s.to_array()))
                .into();
            commitments.push_back(h);
        }
        client.commit_seeds(oracle, &commitments);
    }

    // ------------------------------------------------------------------
    // 1. Request creation stores a pending entry
    // ------------------------------------------------------------------

    #[test]
    fn test_request_creates_pending_entry() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1)]);
        client.request_random(&game, &1u64, &6u64);

        // After request, result is not yet available.
        let result = client.try_get_result(&game, &1u64);
        assert!(result.is_err());

        let status = client.get_request_status(&game, &1u64);
        assert_eq!(status.state, RequestState::Pending);
        assert_eq!(status.max, Some(6u64));
        assert_eq!(status.result, None);
    }

    // ------------------------------------------------------------------
    // 2. Valid fulfillment produces correct deterministic result
    // ------------------------------------------------------------------

    #[test]
    fn test_fulfill_deterministic_result() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 6u64;
        let request_id = 42u64;
        let server_seed = seed(&env, 0xAB);

        commit_seeds_for_test(&env, &client, &oracle, &[server_seed.clone()]);
        client.request_random(&game, &request_id, &max);
        client.fulfill_random(&oracle, &game, &request_id, &server_seed);

        let entry = client.get_result(&game, &request_id);
        let expected = expected_result(&env, &server_seed, request_id, max);

        assert_eq!(entry.result, expected);
        assert_eq!(entry.max, max);
        assert_eq!(entry.server_seed, server_seed);
    }

    // ------------------------------------------------------------------
    // 3. Duplicate request_id rejected (pending case)
    // ------------------------------------------------------------------

    #[test]
    fn test_duplicate_request_id_pending_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1), seed(&env, 2)]);
        client.request_random(&game, &1u64, &2u64);

        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 4. Duplicate request_id rejected (fulfilled case)
    // ------------------------------------------------------------------

    #[test]
    fn test_duplicate_request_id_fulfilled_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 1);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone(), seed(&env, 2)]);
        client.request_random(&game, &1u64, &2u64);
        client.fulfill_random(&oracle, &game, &1u64, &s);

        // Same ID cannot be requested again after fulfillment.
        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 5. Replay fulfillment rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_replay_fulfillment_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 2);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
        client.request_random(&game, &1u64, &2u64);
        client.fulfill_random(&oracle, &game, &1u64, &s);

        // Second fulfill on the same request_id must fail.
        let result = client.try_fulfill_random(&oracle, &game, &1u64, &s);
        assert!(result.is_err());
    }

    #[test]
    fn test_request_status_fulfilled() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let request_id = 77u64;
        let max = 9u64;
        let server_seed = seed(&env, 7);

        commit_seeds_for_test(&env, &client, &oracle, &[server_seed.clone()]);
        client.request_random(&game, &request_id, &max);
        client.fulfill_random(&oracle, &game, &request_id, &server_seed);

        let status = client.get_request_status(&game, &request_id);
        assert_eq!(status.state, RequestState::Fulfilled);
        assert_eq!(status.max, Some(max));
        assert_eq!(
            status.result,
            Some(expected_result(&env, &server_seed, request_id, max))
        );
        assert_eq!(status.server_seed, Some(server_seed));
    }

    #[test]
    fn test_request_status_missing() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        let status = client.get_request_status(&game, &999u64);
        assert_eq!(status.state, RequestState::Missing);
        assert_eq!(status.caller, None);
        assert_eq!(status.max, None);
        assert_eq!(status.result, None);
        assert_eq!(status.server_seed, None);
    }

    // ------------------------------------------------------------------
    // 6. Unauthorized caller (not in whitelist) rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_unauthorized_caller_rejected() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        env.mock_all_auths();

        let stranger = Address::generate(&env);
        let result = client.try_request_random(&stranger, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 7. Non-oracle cannot fulfill
    // ------------------------------------------------------------------

    #[test]
    fn test_unauthorized_fulfill_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s = seed(&env, 3);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
        client.request_random(&game, &1u64, &2u64);

        let impostor = Address::generate(&env);
        let result = client.try_fulfill_random(&impostor, &game, &1u64, &s);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 8. Output always falls within [0, max - 1]
    // ------------------------------------------------------------------

    #[test]
    fn test_result_always_in_range() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 6u64; // simulates a six-sided die

        for i in 0u64..20 {
            let s = seed(&env, i as u8);
            commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
            client.request_random(&game, &i, &max);
            client.fulfill_random(&oracle, &game, &i, &s);
            let entry = client.get_result(&game, &i);
            assert!(
                entry.result < max,
                "result {} out of range [0, {})",
                entry.result,
                max
            );
        }
    }

    // ------------------------------------------------------------------
    // 9. Different seeds produce varying results (smoke test for bias)
    // ------------------------------------------------------------------

    #[test]
    fn test_different_seeds_produce_varied_results() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max = 1_000_000u64;
        let mut results = [0u64; 8];

        for i in 0u64..8 {
            let s = seed(&env, (i * 37) as u8); // spread out seed bytes
            commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
            client.request_random(&game, &i, &max);
            client.fulfill_random(&oracle, &game, &i, &s);
            results[i as usize] = client.get_result(&game, &i).result;
        }

        // All 8 results should be distinct. With max=1_000_000 and only 8
        // samples a collision would indicate a broken hash function.
        for i in 0..8 {
            for j in (i + 1)..8 {
                assert_ne!(results[i], results[j], "collision at indices {i} and {j}");
            }
        }
    }

    // ------------------------------------------------------------------
    // 10. Fulfill non-existent request rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_fulfill_nonexistent_request_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let result = client.try_fulfill_random(&oracle, &game, &99u64, &seed(&env, 0));
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 11. Invalid bound (max < 2) rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_invalid_bound_rejected() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        assert!(client.try_request_random(&game, &1u64, &0u64).is_err());
        assert!(client.try_request_random(&game, &2u64, &1u64).is_err());
    }

    // ------------------------------------------------------------------
    // 12. Revoked caller can no longer request
    // ------------------------------------------------------------------

    #[test]
    fn test_revoked_caller_rejected() {
        let env = Env::default();
        let (client, admin, _, game) = setup(&env);
        env.mock_all_auths();

        client.revoke(&admin, &game);

        let result = client.try_request_random(&game, &1u64, &2u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 13. get_result on pending request returns error
    // ------------------------------------------------------------------

    #[test]
    fn test_get_result_while_pending_returns_error() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1)]);
        client.request_random(&game, &1u64, &4u64);

        // Pending, not yet fulfilled — must return RequestNotFound.
        let result = client.try_get_result(&game, &1u64);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 14. Re-init rejected
    // ------------------------------------------------------------------

    #[test]
    fn test_reinit_rejected() {
        let env = Env::default();
        let (client, admin, oracle, _) = setup(&env);
        env.mock_all_auths();

        let result = client.try_init(&admin, &oracle);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 15. Multiple independent requests fulfilled correctly
    // ------------------------------------------------------------------

    #[test]
    fn test_multiple_requests_independent() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let max_a = 2u64;
        let max_b = 100u64;
        let seed_a = seed(&env, 0x11);
        let seed_b = seed(&env, 0x22);

        commit_seeds_for_test(&env, &client, &oracle, &[seed_a.clone(), seed_b.clone()]);
        client.request_random(&game, &10u64, &max_a);
        client.request_random(&game, &20u64, &max_b);

        client.fulfill_random(&oracle, &game, &10u64, &seed_a);
        client.fulfill_random(&oracle, &game, &20u64, &seed_b);

        let entry_a = client.get_result(&game, &10u64);
        let entry_b = client.get_result(&game, &20u64);

        assert!(entry_a.result < max_a);
        assert!(entry_b.result < max_b);
        assert_eq!(entry_a.result, expected_result(&env, &seed_a, 10, max_a));
        assert_eq!(entry_b.result, expected_result(&env, &seed_b, 20, max_b));
    }

    // ------------------------------------------------------------------
    // 16. Set and get entropy metadata
    // ------------------------------------------------------------------

    #[test]
    fn test_set_and_get_entropy_metadata() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        env.mock_all_auths();

        let metadata = EntropySourceMetadata {
            version: String::from_str(&env, "1.0.0"),
            source_type: String::from_str(&env, "oracle-committed-seed"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };

        client.set_entropy_metadata(&admin, &metadata);
        let retrieved = client.get_entropy_metadata();

        assert_eq!(retrieved.version, String::from_str(&env, "1.0.0"));
        assert_eq!(
            retrieved.source_type,
            String::from_str(&env, "oracle-committed-seed")
        );
        assert_eq!(retrieved.hash_algorithm, String::from_str(&env, "sha256"));
        assert_eq!(retrieved.output_bytes, 8);
    }

    // ------------------------------------------------------------------
    // 17. Non-admin cannot set entropy metadata
    // ------------------------------------------------------------------

    #[test]
    fn test_non_admin_cannot_set_entropy_metadata() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        let metadata = EntropySourceMetadata {
            version: String::from_str(&env, "1.0.0"),
            source_type: String::from_str(&env, "oracle-committed-seed"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };

        let result = client.try_set_entropy_metadata(&game, &metadata);
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 18. Get entropy metadata before set returns error
    // ------------------------------------------------------------------

    #[test]
    fn test_get_entropy_metadata_before_set_returns_error() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        env.mock_all_auths();

        let result = client.try_get_entropy_metadata();
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 19. Metadata update does not affect existing randomness
    // ------------------------------------------------------------------

    #[test]
    fn test_metadata_does_not_affect_randomness() {
        let env = Env::default();
        let (client, admin, oracle, game) = setup(&env);
        env.mock_all_auths();

        // Fulfill a request before setting metadata
        let max = 100u64;
        let s = seed(&env, 0x42);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone(), s.clone()]);
        client.request_random(&game, &1u64, &max);
        client.fulfill_random(&oracle, &game, &1u64, &s);
        let result_before = client.get_result(&game, &1u64).result;

        // Set metadata
        let metadata = EntropySourceMetadata {
            version: String::from_str(&env, "2.0.0"),
            source_type: String::from_str(&env, "oracle-committed-seed"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };
        client.set_entropy_metadata(&admin, &metadata);

        // Fulfill another request with same seed and max at a different ID
        client.request_random(&game, &2u64, &max);
        client.fulfill_random(&oracle, &game, &2u64, &s);
        let result_after = client.get_result(&game, &2u64).result;

        // Results differ because request_id differs, but both are valid
        assert!(result_before < max);
        assert!(result_after < max);

        // The original result is unchanged
        assert_eq!(client.get_result(&game, &1u64).result, result_before);
    }

    // ------------------------------------------------------------------
    // 20. Metadata can be updated by admin
    // ------------------------------------------------------------------

    #[test]
    fn test_metadata_can_be_updated() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        env.mock_all_auths();

        let v1 = EntropySourceMetadata {
            version: String::from_str(&env, "1.0.0"),
            source_type: String::from_str(&env, "oracle-committed-seed"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };
        client.set_entropy_metadata(&admin, &v1);
        assert_eq!(
            client.get_entropy_metadata().version,
            String::from_str(&env, "1.0.0")
        );

        let v2 = EntropySourceMetadata {
            version: String::from_str(&env, "2.0.0"),
            source_type: String::from_str(&env, "oracle-committed-seed-v2"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };
        client.set_entropy_metadata(&admin, &v2);
        assert_eq!(
            client.get_entropy_metadata().version,
            String::from_str(&env, "2.0.0")
        );
    }

    // ------------------------------------------------------------------
    // 21. Get config snapshot returns correct configuration
    // ------------------------------------------------------------------

    #[test]
    fn test_get_config_snapshot() {
        let env = Env::default();
        let (client, admin, oracle, _) = setup(&env);
        env.mock_all_auths();

        let config = client.get_config();

        assert_eq!(config.admin, admin);
        assert_eq!(config.oracle, oracle);
        assert_eq!(config.persistent_ttl, PERSISTENT_BUMP_LEDGERS);
        assert_eq!(config.min_max_bound, 2);
        assert_eq!(config.entropy_version, None);
    }

    // ------------------------------------------------------------------
    // 22. Get config snapshot includes entropy version when set
    // ------------------------------------------------------------------

    #[test]
    fn test_get_config_with_entropy_metadata() {
        let env = Env::default();
        let (client, admin, _, _) = setup(&env);
        env.mock_all_auths();

        let metadata = EntropySourceMetadata {
            version: String::from_str(&env, "1.2.3"),
            source_type: String::from_str(&env, "oracle-committed-seed"),
            hash_algorithm: String::from_str(&env, "sha256"),
            output_bytes: 8,
        };
        client.set_entropy_metadata(&admin, &metadata);

        let config = client.get_config();

        assert_eq!(
            config.entropy_version,
            Some(String::from_str(&env, "1.2.3"))
        );
    }

    // ------------------------------------------------------------------
    // 23. Get config before initialization returns error
    // ------------------------------------------------------------------

    #[test]
    fn test_get_config_before_init_returns_error() {
        let env = Env::default();

        let contract_id = env.register(RandomGenerator, ());
        let client = RandomGeneratorClient::new(&env, &contract_id);

        let result = client.try_get_config();
        assert!(result.is_err());
    }

    // ------------------------------------------------------------------
    // 24. Get requester summary for authorized caller with no requests
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_no_requests() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        let summary = client.get_requester_summary(&game);

        assert_eq!(summary.caller, game);
        assert_eq!(summary.total_requests, 0);
        assert_eq!(summary.pending_count, 0);
        assert_eq!(summary.fulfilled_count, 0);
    }

    // ------------------------------------------------------------------
    // 25. Get requester summary tracks pending requests
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_tracks_pending() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1), seed(&env, 2)]);

        // Make two pending requests
        client.request_random(&game, &1u64, &6u64);
        client.request_random(&game, &2u64, &10u64);

        let summary = client.get_requester_summary(&game);

        assert_eq!(summary.total_requests, 2);
        assert_eq!(summary.pending_count, 2);
        assert_eq!(summary.fulfilled_count, 0);
    }

    // ------------------------------------------------------------------
    // 26. Get requester summary tracks fulfilled requests
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_tracks_fulfilled() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1), seed(&env, 2)]);

        // Make and fulfill two requests
        client.request_random(&game, &1u64, &6u64);
        client.request_random(&game, &2u64, &10u64);
        client.fulfill_random(&oracle, &game, &1u64, &seed(&env, 1));
        client.fulfill_random(&oracle, &game, &2u64, &seed(&env, 2));

        let summary = client.get_requester_summary(&game);

        assert_eq!(summary.total_requests, 2);
        assert_eq!(summary.pending_count, 0);
        assert_eq!(summary.fulfilled_count, 2);
    }

    // ------------------------------------------------------------------
    // 27. Get requester summary tracks mixed state
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_mixed_state() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(
            &env,
            &client,
            &oracle,
            &[seed(&env, 1), seed(&env, 2), seed(&env, 3)],
        );

        // Make three requests, fulfill two
        client.request_random(&game, &1u64, &6u64);
        client.request_random(&game, &2u64, &10u64);
        client.request_random(&game, &3u64, &20u64);

        client.fulfill_random(&oracle, &game, &1u64, &seed(&env, 1));
        client.fulfill_random(&oracle, &game, &3u64, &seed(&env, 3));

        let summary = client.get_requester_summary(&game);

        assert_eq!(summary.total_requests, 3);
        assert_eq!(summary.pending_count, 1);
        assert_eq!(summary.fulfilled_count, 2);
    }

    // ------------------------------------------------------------------
    // 28. Get requester summary for missing caller returns zeros
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_missing_caller() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        env.mock_all_auths();

        let unknown_caller = Address::generate(&env);
        let summary = client.get_requester_summary(&unknown_caller);

        assert_eq!(summary.caller, unknown_caller);
        assert_eq!(summary.total_requests, 0);
        assert_eq!(summary.pending_count, 0);
        assert_eq!(summary.fulfilled_count, 0);
    }

    // ------------------------------------------------------------------
    // 29. Requester summary is side-effect free (multiple calls same result)
    // ------------------------------------------------------------------

    #[test]
    fn test_requester_summary_side_effect_free() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        commit_seeds_for_test(&env, &client, &oracle, &[seed(&env, 1)]);

        client.request_random(&game, &1u64, &6u64);
        client.fulfill_random(&oracle, &game, &1u64, &seed(&env, 1));

        // Call summary multiple times
        let summary1 = client.get_requester_summary(&game);
        let summary2 = client.get_requester_summary(&game);
        let summary3 = client.get_requester_summary(&game);

        // All should be identical
        assert_eq!(summary1, summary2);
        assert_eq!(summary2, summary3);
        assert_eq!(summary1.total_requests, 1);
        assert_eq!(summary1.pending_count, 0);
        assert_eq!(summary1.fulfilled_count, 1);
    }

    // ------------------------------------------------------------------
    // 30. Multiple requesters tracked independently
    // ------------------------------------------------------------------

    #[test]
    fn test_multiple_requesters_independent() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let game1 = Address::generate(&env);
        let game2 = Address::generate(&env);

        let contract_id = env.register(RandomGenerator, ());
        let client = RandomGeneratorClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin, &oracle);
        client.authorize(&admin, &game1);
        client.authorize(&admin, &game2);

        commit_seeds_for_test(
            &env,
            &client,
            &oracle,
            &[
                seed(&env, 1),
                seed(&env, 2),
                seed(&env, 3),
                seed(&env, 4),
                seed(&env, 5),
            ],
        );

        // Game1 makes 2 requests, fulfills 1
        client.request_random(&game1, &1u64, &6u64);
        client.request_random(&game1, &2u64, &10u64);
        client.fulfill_random(&oracle, &game1, &1u64, &seed(&env, 1));

        // Game2 makes 3 requests, fulfills 2
        client.request_random(&game2, &3u64, &6u64);
        client.request_random(&game2, &4u64, &10u64);
        client.request_random(&game2, &5u64, &20u64);
        client.fulfill_random(&oracle, &game2, &3u64, &seed(&env, 3));
        client.fulfill_random(&oracle, &game2, &4u64, &seed(&env, 4));

        let summary1 = client.get_requester_summary(&game1);
        let summary2 = client.get_requester_summary(&game2);

        assert_eq!(summary1.total_requests, 2);
        assert_eq!(summary1.pending_count, 1);
        assert_eq!(summary1.fulfilled_count, 1);

        assert_eq!(summary2.total_requests, 3);
        assert_eq!(summary2.pending_count, 1);
        assert_eq!(summary2.fulfilled_count, 2);
    }

    // ------------------------------------------------------------------
    // 31. Seed commitment enforcement tests (#1374)
    // ------------------------------------------------------------------

    #[test]
    fn test_seed_commitment_mismatch_rejected() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let honest_seed = seed(&env, 0x11);
        let malicious_seed = seed(&env, 0x22);

        commit_seeds_for_test(&env, &client, &oracle, &[honest_seed.clone()]);
        client.request_random(&game, &1u64, &2u64);

        // Fulfilling with malicious_seed must fail with SeedCommitmentMismatch
        let res = client.try_fulfill_random(&oracle, &game, &1u64, &malicious_seed);
        assert_eq!(res, Err(Ok(Error::SeedCommitmentMismatch)));

        // Request can still be fulfilled with honest_seed
        client.fulfill_random(&oracle, &game, &1u64, &honest_seed);
        let result = client.get_result(&game, &1u64);
        assert_eq!(result.server_seed, honest_seed);
    }

    #[test]
    fn test_request_random_empty_queue_rejected() {
        let env = Env::default();
        let (client, _, _, game) = setup(&env);
        env.mock_all_auths();

        // Queue is empty -> fails with NoCommitmentAvailable
        let res = client.try_request_random(&game, &1u64, &2u64);
        assert_eq!(res, Err(Ok(Error::NoCommitmentAvailable)));
    }

    #[test]
    fn test_commitments_consumed_in_fifo_order() {
        let env = Env::default();
        let (client, _, oracle, game) = setup(&env);
        env.mock_all_auths();

        let s1 = seed(&env, 1);
        let s2 = seed(&env, 2);
        let s3 = seed(&env, 3);

        commit_seeds_for_test(
            &env,
            &client,
            &oracle,
            &[s1.clone(), s2.clone(), s3.clone()],
        );
        assert_eq!(client.get_commitment_queue_len(), 3);

        client.request_random(&game, &100u64, &2u64);
        assert_eq!(client.get_commitment_queue_len(), 2);

        client.request_random(&game, &200u64, &2u64);
        assert_eq!(client.get_commitment_queue_len(), 1);

        client.request_random(&game, &300u64, &2u64);
        assert_eq!(client.get_commitment_queue_len(), 0);

        // First request bound to s1, second to s2, third to s3
        client.fulfill_random(&oracle, &game, &100u64, &s1);
        client.fulfill_random(&oracle, &game, &200u64, &s2);
        client.fulfill_random(&oracle, &game, &300u64, &s3);

        assert_eq!(client.get_result(&game, &100u64).server_seed, s1);
        assert_eq!(client.get_result(&game, &200u64).server_seed, s2);
        assert_eq!(client.get_result(&game, &300u64).server_seed, s3);
    }

    #[test]
    fn test_commit_seeds_oracle_only() {
        let env = Env::default();
        let (client, _, _, _) = setup(&env);
        env.mock_all_auths();

        let non_oracle = Address::generate(&env);
        let commitments = soroban_sdk::Vec::new(&env);
        let res = client.try_commit_seeds(&non_oracle, &commitments);
        assert!(res.is_err());
    }

    // ------------------------------------------------------------------
    // Request IDs are namespaced per caller (#1386)
    // ------------------------------------------------------------------

    fn authorize_second_game(
        env: &Env,
        client: &RandomGeneratorClient<'_>,
        admin: &Address,
    ) -> Address {
        let game2 = Address::generate(env);
        client.authorize(admin, &game2);
        game2
    }

    #[test]
    fn test_two_callers_can_reuse_the_same_request_id() {
        let env = Env::default();
        let (client, admin, oracle, game) = setup(&env);
        let game2 = authorize_second_game(&env, &client, &admin);

        let s1 = seed(&env, 1);
        let s2 = seed(&env, 2);
        commit_seeds_for_test(&env, &client, &oracle, &[s1.clone(), s2.clone()]);

        // Both games use request_id 7 (e.g. each passes its own game_id).
        client.request_random(&game, &7u64, &2u64);
        client.request_random(&game2, &7u64, &6u64);

        client.fulfill_random(&oracle, &game, &7u64, &s1);
        client.fulfill_random(&oracle, &game2, &7u64, &s2);

        let first = client.get_result(&game, &7u64);
        let second = client.get_result(&game2, &7u64);
        assert_eq!(first.caller, game);
        assert_eq!(second.caller, game2);
        assert_eq!(first.server_seed, s1);
        assert_eq!(second.server_seed, s2);
        // The derivation formula is unchanged: sha256(seed || request_id_be) % max.
        assert_eq!(first.result, expected_result(&env, &s1, 7, 2));
        assert_eq!(second.result, expected_result(&env, &s2, 7, 6));
    }

    #[test]
    fn test_duplicate_request_id_from_same_caller_still_rejected() {
        let env = Env::default();
        let (client, admin, oracle, game) = setup(&env);
        let game2 = authorize_second_game(&env, &client, &admin);

        commit_seeds_for_test(
            &env,
            &client,
            &oracle,
            &[seed(&env, 1), seed(&env, 2), seed(&env, 3)],
        );
        client.request_random(&game, &7u64, &2u64);
        client.request_random(&game2, &7u64, &2u64);

        assert_eq!(
            client.try_request_random(&game, &7u64, &2u64),
            Err(Ok(Error::DuplicateRequestId))
        );
        assert_eq!(
            client.try_request_random(&game2, &7u64, &2u64),
            Err(Ok(Error::DuplicateRequestId))
        );
    }

    #[test]
    fn test_fulfilling_for_the_wrong_caller_is_rejected() {
        let env = Env::default();
        let (client, admin, oracle, game) = setup(&env);
        let game2 = authorize_second_game(&env, &client, &admin);

        let s = seed(&env, 1);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
        client.request_random(&game, &7u64, &2u64);

        // game2 never requested id 7, so there is nothing to fulfil for it.
        assert_eq!(
            client.try_fulfill_random(&oracle, &game2, &7u64, &s),
            Err(Ok(Error::RequestNotFound))
        );
        assert_eq!(
            client.try_get_result(&game2, &7u64),
            Err(Ok(Error::RequestNotFound))
        );
        assert_eq!(
            client.get_request_status(&game2, &7u64).state,
            RequestState::Missing
        );

        // The real owner is unaffected and can still be fulfilled.
        assert_eq!(
            client.get_request_status(&game, &7u64).state,
            RequestState::Pending
        );
        client.fulfill_random(&oracle, &game, &7u64, &s);
        assert_eq!(
            client.get_request_status(&game, &7u64).state,
            RequestState::Fulfilled
        );
    }

    // ------------------------------------------------------------------
    // Instance storage TTL (#1385)
    // ------------------------------------------------------------------

    fn instance_ttl(env: &Env, contract_id: &Address) -> u32 {
        use soroban_sdk::testutils::storage::Instance as _;
        env.as_contract(contract_id, || env.storage().instance().get_ttl())
    }

    fn advance_ledgers(env: &Env, ledgers: u32) {
        use soroban_sdk::testutils::Ledger;
        env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }

    #[test]
    fn test_state_changing_calls_extend_instance_ttl() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);
        let game = Address::generate(&env);
        let contract_id = env.register(RandomGenerator, ());
        let client = RandomGeneratorClient::new(&env, &contract_id);
        env.mock_all_auths();

        // Starts well below the bump value.
        assert!(instance_ttl(&env, &contract_id) < INSTANCE_BUMP_LEDGERS);

        client.init(&admin, &oracle);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        // Let the TTL decay below the threshold before each call so the bump is
        // observable, but stay short of expiry of the persistent entries.
        let decay = INSTANCE_BUMP_LEDGERS - INSTANCE_LIFETIME_THRESHOLD + 1_000;

        advance_ledgers(&env, decay);
        assert!(instance_ttl(&env, &contract_id) < INSTANCE_LIFETIME_THRESHOLD);
        client.authorize(&admin, &game);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        let s = seed(&env, 1);
        advance_ledgers(&env, decay);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        advance_ledgers(&env, decay);
        client.request_random(&game, &1u64, &2u64);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        advance_ledgers(&env, decay);
        client.fulfill_random(&oracle, &game, &1u64, &s);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        advance_ledgers(&env, decay);
        client.set_entropy_metadata(
            &admin,
            &EntropySourceMetadata {
                version: String::from_str(&env, "1.0.0"),
                source_type: String::from_str(&env, "oracle"),
                hash_algorithm: String::from_str(&env, "sha256"),
                output_bytes: 8,
            },
        );
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);

        advance_ledgers(&env, decay);
        client.revoke(&admin, &game);
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);
    }

    #[test]
    fn test_contract_still_works_after_original_instance_ttl_passed() {
        let env = Env::default();
        let (client, admin, oracle, game) = setup(&env);
        let contract_id = client.address.clone();
        env.mock_all_auths();

        // TTL granted by `init`. Each call below renews it; without that, the
        // instance entry (admin/oracle config) would lapse once the ledger
        // passes this point and every call would fail until restored.
        let original_ttl = instance_ttl(&env, &contract_id);

        // Step past the original expiry in two hops, with a state-changing call
        // in between that renews both the instance and the whitelist entry.
        advance_ledgers(&env, original_ttl / 2 + 1_000);
        client.authorize(&admin, &game);
        advance_ledgers(&env, original_ttl / 2 + 1_000);

        let s = seed(&env, 9);
        commit_seeds_for_test(&env, &client, &oracle, &[s.clone()]);
        client.request_random(&game, &1u64, &6u64);
        client.fulfill_random(&oracle, &game, &1u64, &s);
        assert_eq!(client.get_result(&game, &1u64).server_seed, s);

        // The instance entry now outlives the original expiry.
        assert!(instance_ttl(&env, &contract_id) >= INSTANCE_BUMP_LEDGERS);
    }
}
