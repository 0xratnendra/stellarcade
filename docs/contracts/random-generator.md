# random-generator

A pending randomness request registered by an authorized game contract.

## Public Methods

### `init`
Initialize the contract. May only be called once.  `oracle` is the sole address permitted to call `fulfill_random`. It is expected to be a backend service that pre-commits server seeds off-chain before each game round begins.

```rust
pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `oracle` | `Address` |

#### Return Type

`Result<(), Error>`

### `authorize`
Add a game contract to the caller whitelist. Admin only.

```rust
pub fn authorize(env: Env, admin: Address, caller: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `caller` | `Address` |

#### Return Type

`Result<(), Error>`

### `revoke`
Remove a game contract from the caller whitelist. Admin only.

```rust
pub fn revoke(env: Env, admin: Address, caller: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `caller` | `Address` |

#### Return Type

`Result<(), Error>`

### `commit_seeds`
Commit a batch of oracle seed commitments (sha256 of server seeds) to the FIFO queue. Oracle only. Returns the new queue length.

```rust
pub fn commit_seeds(env: Env, oracle: Address, commitments: Vec<BytesN<32>>) -> Result<u32, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `oracle` | `Address` |
| `commitments` | `Vec<BytesN<32>>` |

#### Return Type

`Result<u32, Error>`

### `get_commitment_queue_len`
Read the number of pending seed commitments available in the queue.

```rust
pub fn get_commitment_queue_len(env: Env) -> u32
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`u32`

### `request_random`
Submit a randomness request. Only whitelisted callers may call this.  `max` must be >= 2. The fulfilled result will be in `[0, max - 1]`. `request_id` must be unique **per caller** — rejected if this caller already has a pending or fulfilled entry for the same ID. Different authorised callers may reuse the same ID independently.  Pops the next commitment from the FIFO queue. If the queue is empty, fails with `NoCommitmentAvailable`.

```rust
pub fn request_random(env: Env, caller: Address, request_id: u64, max: u64) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `caller` | `Address` |
| `request_id` | `u64` |
| `max` | `u64` |

#### Return Type

`Result<(), Error>`

### `fulfill_random`
Fulfill a pending randomness request. Oracle only.  The result is derived as: `sha256(server_seed || request_id_be_bytes)[0..8] % max`  Enforces that `sha256(server_seed) == pending.commitment`, proving the seed was committed on-chain before the request was created. Both `server_seed`, `commitment` and `result` are persisted for on-chain verification.  `caller` is the game contract that submitted the request; requests are namespaced by `(caller, request_id)`. Fulfilling with a caller that did not submit `request_id` fails with `RequestNotFound`.

```rust
pub fn fulfill_random(env: Env, oracle: Address, caller: Address, request_id: u64, server_seed: BytesN<32>) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `oracle` | `Address` |
| `caller` | `Address` |
| `request_id` | `u64` |
| `server_seed` | `BytesN<32>` |

#### Return Type

`Result<(), Error>`

### `set_entropy_metadata`
Set entropy source version metadata. Admin only.  Metadata is informational and does not affect randomness output.

```rust
pub fn set_entropy_metadata(env: Env, admin: Address, metadata: EntropySourceMetadata) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `metadata` | `EntropySourceMetadata` |

#### Return Type

`Result<(), Error>`

### `get_entropy_metadata`
Read the current entropy source version metadata.

```rust
pub fn get_entropy_metadata(env: Env) -> Result<EntropySourceMetadata, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<EntropySourceMetadata, Error>`

### `get_result`
Return the fulfilled result for `caller`'s `request_id`.  Returns `RequestNotFound` if the request is still pending, never existed, or belongs to a different caller.

```rust
pub fn get_result(env: Env, caller: Address, request_id: u64) -> Result<FulfilledEntry, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `caller` | `Address` |
| `request_id` | `u64` |

#### Return Type

`Result<FulfilledEntry, Error>`

### `get_request_status`
Return the lifecycle status for `caller`'s request id.

```rust
pub fn get_request_status(env: Env, caller: Address, request_id: u64) -> Result<RequestStatus, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `caller` | `Address` |
| `request_id` | `u64` |

#### Return Type

`Result<RequestStatus, Error>`

### `get_config`
Return a stable snapshot of the generator's operational configuration.  This is a read-only, side-effect-free accessor designed for operational tooling. The config shape is extensible for future generator policy fields.

```rust
pub fn get_config(env: Env) -> Result<GeneratorConfig, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<GeneratorConfig, Error>`

### `get_requester_summary`
Return a per-requester sequencing summary showing their request history.  This is a deterministic, side-effect-free read operation. For missing requesters (never authorized or no requests), returns a summary with all counts at zero.

```rust
pub fn get_requester_summary(env: Env, caller: Address) -> RequesterSummary
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `caller` | `Address` |

#### Return Type

`RequesterSummary`

