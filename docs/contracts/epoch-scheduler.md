# epoch-scheduler

Read-only timing snapshot returned by `epoch_snapshot`.  All ledger values are expressed in ledger-sequence units. Returns `None` from `epoch_snapshot` when the contract is not yet initialised.

## Public Methods

### `init`
Initialise the epoch scheduler contract.

```rust
pub fn init(env: Env, admin: Address, epoch_duration: u32) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `epoch_duration` | `u32` |

#### Return Type

`Result<(), Error>`

### `current_epoch`
View the current epoch based on ledger sequence.

```rust
pub fn current_epoch(env: Env) -> u64
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`u64`

### `schedule_task`
Schedule a task for a future or current epoch.  Only an address the admin has approved via `add_scheduler` may schedule tasks. The `scheduler` address must authorise the call.  A `task_id` can only be used once: scheduling a task whose id already exists fails with `TaskAlreadyExists` rather than overwriting the stored `payload_hash`. An admin can retire a task with `cancel_task`.

```rust
pub fn schedule_task(env: Env, scheduler: Address, task_id: Symbol, epoch: u64, payload_hash: BytesN<32>) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `scheduler` | `Address` |
| `task_id` | `Symbol` |
| `epoch` | `u64` |
| `payload_hash` | `BytesN<32>` |

#### Return Type

`Result<(), Error>`

### `add_scheduler`
Approve an address as a scheduler. Admin only.  The approved address may then call `schedule_task`. Approving an address that is already approved is a no-op.

```rust
pub fn add_scheduler(env: Env, admin: Address, scheduler: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `scheduler` | `Address` |

#### Return Type

`Result<(), Error>`

### `cancel_task`
Cancel a scheduled task. Admin only.  Removes the task so its id and payload are no longer scheduled. A task that was already executed cannot be cancelled.

```rust
pub fn cancel_task(env: Env, admin: Address, task_id: Symbol) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `task_id` | `Symbol` |

#### Return Type

`Result<(), Error>`

### `mark_executed`
Mark a task as executed. Restricted to Admin.

```rust
pub fn mark_executed(env: Env, task_id: Symbol) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `task_id` | `Symbol` |

#### Return Type

`Result<(), Error>`

### `task_state`
Query the state of a task.

```rust
pub fn task_state(env: Env, task_id: Symbol) -> Option<TaskData>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `task_id` | `Symbol` |

#### Return Type

`Option<TaskData>`

### `epoch_snapshot`
Returns a timing snapshot combining the current epoch, the next epoch boundary, and the ledger at which the current epoch began (last rollover).  Returns `None` when the contract has not yet been initialised or the epoch duration is zero, making the uninitialized state explicit.

```rust
pub fn epoch_snapshot(env: Env) -> Option<EpochSnapshot>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Option<EpochSnapshot>`

