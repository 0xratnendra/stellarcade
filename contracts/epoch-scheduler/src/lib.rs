#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    Symbol, Vec,
};

// ---------------------------------------------------------------------------
// TTL / storage constants
// ---------------------------------------------------------------------------

const PERSISTENT_BUMP_LEDGERS: u32 = 518_400; // ~30 days
const PERSISTENT_BUMP_THRESHOLD: u32 = PERSISTENT_BUMP_LEDGERS - 100_800; // Renew ~7 days early

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidEpochDuration = 4,
    InvalidScheduleEpoch = 5,
    TaskAlreadyExecuted = 6,
    TaskNotFound = 7,
    EpochNotReached = 8,
    TaskAlreadyExists = 9,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskData {
    pub epoch: u64,
    pub payload_hash: BytesN<32>,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    EpochDuration,
    Task(Symbol), // Keyed by task_id
    Schedulers,   // Vec<Address> of admin-approved scheduler addresses
}

// ---------------------------------------------------------------------------
// Epoch snapshot
// ---------------------------------------------------------------------------

/// Read-only timing snapshot returned by `epoch_snapshot`.
///
/// All ledger values are expressed in ledger-sequence units.
/// Returns `None` from `epoch_snapshot` when the contract is not yet
/// initialised.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpochSnapshot {
    /// The epoch that is active at the current ledger sequence.
    pub current_epoch: u64,
    /// Number of ledgers per epoch as configured at init time.
    pub epoch_duration: u32,
    /// The ledger sequence at which the current epoch started (last rollover).
    pub current_epoch_start_ledger: u64,
    /// The ledger sequence at which the next epoch will begin.
    pub next_epoch_start_ledger: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
pub struct ContractInitialized {
    pub admin: Address,
    pub epoch_duration: u32,
}

#[contractevent]
pub struct TaskScheduled {
    pub task_id: Symbol,
    pub epoch: u64,
}

#[contractevent]
pub struct TaskExecuted {
    pub task_id: Symbol,
}

/// Emitted when the admin approves a new scheduler address.
#[contractevent]
pub struct SchedulerAdded {
    #[topic]
    pub admin: Address,
    #[topic]
    pub scheduler: Address,
}

/// Emitted when the admin cancels a scheduled task.
#[contractevent]
pub struct TaskCancelled {
    #[topic]
    pub admin: Address,
    #[topic]
    pub task_id: Symbol,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct EpochScheduler;

#[contractimpl]
impl EpochScheduler {
    /// Initialise the epoch scheduler contract.
    pub fn init(env: Env, admin: Address, epoch_duration: u32) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        if epoch_duration == 0 {
            return Err(Error::InvalidEpochDuration);
        }

        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::EpochDuration, &epoch_duration);

        ContractInitialized {
            admin,
            epoch_duration,
        }
        .publish(&env);

        Ok(())
    }

    /// View the current epoch based on ledger sequence.
    pub fn current_epoch(env: Env) -> u64 {
        let duration: u32 = env
            .storage()
            .instance()
            .get(&DataKey::EpochDuration)
            .unwrap_or(0);
        if duration == 0 {
            return 0;
        }
        (env.ledger().sequence() as u64) / (duration as u64)
    }

    /// Schedule a task for a future or current epoch.
    ///
    /// Only an address the admin has approved via `add_scheduler` may
    /// schedule tasks. The `scheduler` address must authorise the call.
    ///
    /// A `task_id` can only be used once: scheduling a task whose id already
    /// exists fails with `TaskAlreadyExists` rather than overwriting the
    /// stored `payload_hash`. An admin can retire a task with `cancel_task`.
    pub fn schedule_task(
        env: Env,
        scheduler: Address,
        task_id: Symbol,
        epoch: u64,
        payload_hash: BytesN<32>,
    ) -> Result<(), Error> {
        scheduler.require_auth();

        if !Self::is_scheduler(&env, &scheduler) {
            return Err(Error::NotAuthorized);
        }

        let current = Self::current_epoch(env.clone());
        if epoch < current {
            return Err(Error::InvalidScheduleEpoch);
        }

        let key = DataKey::Task(task_id.clone());

        // A task id is single-use. Overwriting an existing task would let a
        // scheduler silently replace the payload of a task another scheduler
        // already scheduled, so reject instead.
        if env.storage().persistent().has(&key) {
            return Err(Error::TaskAlreadyExists);
        }

        let data = TaskData {
            epoch,
            payload_hash,
            executed: false,
        };

        env.storage().persistent().set(&key, &data);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_BUMP_LEDGERS,
        );

        TaskScheduled { task_id, epoch }.publish(&env);

        Ok(())
    }

    /// Approve an address as a scheduler. Admin only.
    ///
    /// The approved address may then call `schedule_task`. Approving an
    /// address that is already approved is a no-op.
    pub fn add_scheduler(env: Env, admin: Address, scheduler: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin_caller(&env, &admin)?;

        let mut schedulers: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Schedulers)
            .unwrap_or_else(|| Vec::new(&env));

        if !schedulers.contains(&scheduler) {
            schedulers.push_back(scheduler.clone());
            env.storage()
                .instance()
                .set(&DataKey::Schedulers, &schedulers);
        }

        SchedulerAdded { admin, scheduler }.publish(&env);

        Ok(())
    }

    /// Cancel a scheduled task. Admin only.
    ///
    /// Removes the task so its id and payload are no longer scheduled. A
    /// task that was already executed cannot be cancelled.
    pub fn cancel_task(env: Env, admin: Address, task_id: Symbol) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin_caller(&env, &admin)?;

        let key = DataKey::Task(task_id.clone());
        let task: TaskData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::TaskNotFound)?;

        if task.executed {
            return Err(Error::TaskAlreadyExecuted);
        }

        env.storage().persistent().remove(&key);

        TaskCancelled { admin, task_id }.publish(&env);

        Ok(())
    }

    /// Mark a task as executed. Restricted to Admin.
    pub fn mark_executed(env: Env, task_id: Symbol) -> Result<(), Error> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();

        let current = Self::current_epoch(env.clone());
        let key = DataKey::Task(task_id.clone());

        let mut task: TaskData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::TaskNotFound)?;

        if task.executed {
            return Err(Error::TaskAlreadyExecuted);
        }

        if current < task.epoch {
            return Err(Error::EpochNotReached);
        }

        task.executed = true;
        env.storage().persistent().set(&key, &task);

        TaskExecuted { task_id }.publish(&env);

        Ok(())
    }

    /// Query the state of a task.
    pub fn task_state(env: Env, task_id: Symbol) -> Option<TaskData> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    /// Returns a timing snapshot combining the current epoch, the next epoch
    /// boundary, and the ledger at which the current epoch began (last
    /// rollover).
    ///
    /// Returns `None` when the contract has not yet been initialised or the
    /// epoch duration is zero, making the uninitialized state explicit.
    pub fn epoch_snapshot(env: Env) -> Option<EpochSnapshot> {
        let duration: u32 = env.storage().instance().get(&DataKey::EpochDuration)?;
        if duration == 0 {
            return None;
        }
        let sequence = env.ledger().sequence() as u64;
        let duration_u64 = duration as u64;
        let current_epoch = sequence / duration_u64;
        let current_epoch_start_ledger = current_epoch * duration_u64;
        let next_epoch_start_ledger = current_epoch_start_ledger.saturating_add(duration_u64);

        Some(EpochSnapshot {
            current_epoch,
            epoch_duration: duration,
            current_epoch_start_ledger,
            next_epoch_start_ledger,
        })
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn require_admin(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Require that `caller` is the stored admin.
    fn require_admin_caller(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = Self::require_admin(env)?;
        if caller != &admin {
            return Err(Error::NotAuthorized);
        }
        Ok(())
    }

    /// Addresses the admin has approved as schedulers.
    fn schedulers(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Schedulers)
            .unwrap_or_else(|| Vec::new(env))
    }

    /// Whether `address` is an admin-approved scheduler.
    fn is_scheduler(env: &Env, address: &Address) -> bool {
        Self::schedulers(env).contains(address)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        symbol_short,
        testutils::{Address as _, Ledger},
        Address, BytesN, Env,
    };

    struct Setup<'a> {
        env: Env,
        client: EpochSchedulerClient<'a>,
        admin: Address,
        scheduler: Address,
    }

    fn setup() -> Setup<'static> {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EpochScheduler, ());
        let client = EpochSchedulerClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.init(&admin, &100); // 100 ledgers per epoch

        let scheduler = Address::generate(&env);
        client.add_scheduler(&admin, &scheduler);

        let client: EpochSchedulerClient<'static> = unsafe { core::mem::transmute(client) };

        Setup {
            env,
            client,
            admin,
            scheduler,
        }
    }

    #[test]
    fn test_current_epoch() {
        let s = setup();

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 50,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        assert_eq!(s.client.current_epoch(), 0);

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 150,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        assert_eq!(s.client.current_epoch(), 1);

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 1000,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        assert_eq!(s.client.current_epoch(), 10);
    }

    #[test]
    fn test_scheduling_and_execution() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 50, // Epoch 0
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });

        // Schedule for epoch 2
        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);

        let state = s.client.task_state(&task_id).unwrap();
        assert_eq!(state.epoch, 2);
        assert!(!state.executed);

        // Attempt to execute in epoch 1 - should fail
        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 150, // Epoch 1
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        let result = s.client.try_mark_executed(&task_id);
        assert_eq!(result, Err(Ok(Error::EpochNotReached)));

        // Execute in epoch 2 - should succeed
        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 250, // Epoch 2
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        s.client.mark_executed(&task_id);

        let state = s.client.task_state(&task_id).unwrap();
        assert!(state.executed);
    }

    #[test]
    fn test_invalid_schedule_epoch() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 550, // Epoch 5
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });

        // Attempt to schedule for epoch 4 - should fail
        let result = s
            .client
            .try_schedule_task(&s.scheduler, &task_id, &4, &hash);
        assert_eq!(result, Err(Ok(Error::InvalidScheduleEpoch)));
    }

    // ── scheduler authorisation ───────────────────────────────────────────────

    #[test]
    fn test_unauthorised_scheduler_rejected() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        // A stranger that the admin never approved cannot schedule.
        let stranger = Address::generate(&s.env);
        let result = s.client.try_schedule_task(&stranger, &task_id, &2, &hash);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));

        // Nothing was written for the rejected call.
        assert!(s.client.task_state(&task_id).is_none());
    }

    #[test]
    fn test_unauthorised_scheduler_rejected_without_auth() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        // Drop the blanket auth mock: the stranger's signature is missing.
        s.env.set_auths(&[]);
        let stranger = Address::generate(&s.env);
        let result = s.client.try_schedule_task(&stranger, &task_id, &2, &hash);
        assert!(result.is_err());

        assert!(s.client.task_state(&task_id).is_none());
    }

    #[test]
    fn test_authorised_scheduler_succeeds() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);

        let state = s.client.task_state(&task_id).unwrap();
        assert_eq!(state.epoch, 2);
        assert_eq!(state.payload_hash, hash);
        assert!(!state.executed);
    }

    #[test]
    fn test_overwriting_existing_task_rejected() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);
        let other_hash = BytesN::from_array(&s.env, &[1u8; 32]);

        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);

        // A second schedule for the same task id must not overwrite the
        // stored payload.
        let result = s
            .client
            .try_schedule_task(&s.scheduler, &task_id, &3, &other_hash);
        assert_eq!(result, Err(Ok(Error::TaskAlreadyExists)));

        let state = s.client.task_state(&task_id).unwrap();
        assert_eq!(state.epoch, 2);
        assert_eq!(state.payload_hash, hash);
    }

    #[test]
    fn test_admin_can_cancel_task() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);
        assert!(s.client.task_state(&task_id).is_some());

        s.client.cancel_task(&s.admin, &task_id);

        // The task is gone, so its id can be scheduled again.
        assert!(s.client.task_state(&task_id).is_none());

        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);
        assert!(s.client.task_state(&task_id).is_some());
    }

    #[test]
    fn test_non_admin_cannot_cancel_task() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.client.schedule_task(&s.scheduler, &task_id, &2, &hash);

        let stranger = Address::generate(&s.env);
        let result = s.client.try_cancel_task(&stranger, &task_id);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));

        // The task survives the rejected cancel.
        assert!(s.client.task_state(&task_id).is_some());
    }

    #[test]
    fn test_non_admin_cannot_add_scheduler() {
        let s = setup();

        let stranger = Address::generate(&s.env);
        let result = s.client.try_add_scheduler(&stranger, &stranger);
        assert_eq!(result, Err(Ok(Error::NotAuthorized)));
    }

    #[test]
    fn test_cancel_missing_task_fails() {
        let s = setup();
        let task_id = symbol_short!("task1");

        let result = s.client.try_cancel_task(&s.admin, &task_id);
        assert_eq!(result, Err(Ok(Error::TaskNotFound)));
    }

    #[test]
    fn test_cancel_executed_task_fails() {
        let s = setup();
        let task_id = symbol_short!("task1");
        let hash = BytesN::from_array(&s.env, &[0u8; 32]);

        s.client.schedule_task(&s.scheduler, &task_id, &0, &hash);
        s.client.mark_executed(&task_id);

        let result = s.client.try_cancel_task(&s.admin, &task_id);
        assert_eq!(result, Err(Ok(Error::TaskAlreadyExecuted)));

        // The executed task is still recorded.
        assert!(s.client.task_state(&task_id).unwrap().executed);
    }

    // ── epoch_snapshot ────────────────────────────────────────────────────────

    #[test]
    fn test_epoch_snapshot_uninitialized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EpochScheduler, ());
        let client = EpochSchedulerClient::new(&env, &contract_id);
        // Contract not yet initialised — snapshot must be None
        assert!(client.epoch_snapshot().is_none());
    }

    #[test]
    fn test_epoch_snapshot_active_state() {
        let s = setup(); // epoch_duration = 100

        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 250, // Epoch 2 (250 / 100 = 2)
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });

        let snap = s.client.epoch_snapshot().unwrap();
        assert_eq!(snap.current_epoch, 2);
        assert_eq!(snap.epoch_duration, 100);
        assert_eq!(snap.current_epoch_start_ledger, 200); // 2 * 100
        assert_eq!(snap.next_epoch_start_ledger, 300); // 3 * 100
    }

    #[test]
    fn test_epoch_snapshot_last_rollover_after_transition() {
        let s = setup(); // epoch_duration = 100

        // Before rollover: sequence 199 → epoch 1
        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 199,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        let snap_before = s.client.epoch_snapshot().unwrap();
        assert_eq!(snap_before.current_epoch, 1);
        assert_eq!(snap_before.current_epoch_start_ledger, 100);
        assert_eq!(snap_before.next_epoch_start_ledger, 200);

        // After rollover: sequence 200 → epoch 2
        s.env.ledger().set(soroban_sdk::testutils::LedgerInfo {
            timestamp: 0,
            protocol_version: 25,
            sequence_number: 200,
            network_id: [0u8; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 1000000,
        });
        let snap_after = s.client.epoch_snapshot().unwrap();
        assert_eq!(snap_after.current_epoch, 2);
        assert_eq!(snap_after.current_epoch_start_ledger, 200);
        assert_eq!(snap_after.next_epoch_start_ledger, 300);
    }
}
