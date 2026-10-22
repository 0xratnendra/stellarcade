# Random Generator Contract

The Random Generator provides provably fair, bounded randomness for all Stellarcade game contracts. It operates on a two-phase request/fulfill model backed by an off-chain oracle that pre-commits to its server seeds before rounds begin.

---

## Fairness Model

The contract uses a **commit-then-reveal** scheme:

1. **Before** a game round begins, the oracle publishes `sha256(server_seed)` off-chain (e.g., on the game's website or in a social post). This commitment locks the oracle to a specific seed it cannot change.
2. A game contract calls `request_random`, registering the round and its randomness bound.
3. The oracle calls `fulfill_random` with the pre-committed `server_seed`. The contract derives the result as:

   ```
   sha256(server_seed || request_id_be_bytes)[0..8] % max
   ```

4. Both the `server_seed` and `result` are stored permanently on-chain. Anyone can independently verify:
   - Re-compute `sha256(server_seed)` and compare it to the oracle's published commitment.
   - Re-run `sha256(server_seed || request_id_be)[0..8] % max` and confirm it matches `result`.

**Why mixing `request_id` into the preimage matters:** if the same server seed were used across multiple requests without including the `request_id`, the oracle could reuse one commitment for many rounds. The `request_id` in the preimage ensures every request gets a unique output even when the oracle commits to a seed batch.

**Trust assumption:** the oracle must publish its commitment *before* the game contract submits the request. The contract itself does not enforce this timing — it trusts that the oracle follows the protocol. Off-chain tooling or a separate commitment contract can be used to enforce this stricter ordering.

---

## Methods

### `init(admin: Address, oracle: Address) -> Result<(), Error>`

Initializes the contract. May only be called once.

- `admin` — manages the authorized-caller whitelist.
- `oracle` — the sole address permitted to call `fulfill_random`.

---

### `authorize(admin: Address, caller: Address) -> Result<(), Error>`

Add a game contract to the caller whitelist. Admin only.

---

### `revoke(admin: Address, caller: Address) -> Result<(), Error>`

Remove a game contract from the caller whitelist. Admin only.

---

### `request_random(caller: Address, request_id: u64, max: u64) -> Result<(), Error>`

Register a pending randomness request. Whitelisted callers only.

- `caller` must be in the authorized whitelist and must sign the transaction.
- `max` must be `>= 2`. The fulfilled result will be in `[0, max - 1]`.
- `request_id` is namespaced per `caller`: it must be unique among that caller's pending and previously fulfilled requests (reuse is rejected so a game cannot re-request after seeing a result), but two authorised callers may use the same `request_id` independently.
- Emits: `RandomRequested { request_id, caller, max }`.

---

### `fulfill_random(oracle: Address, caller: Address, request_id: u64, server_seed: BytesN<32>) -> Result<(), Error>`

Fulfill a pending request. Oracle only.

- Derives result: `sha256(server_seed || request_id_be_bytes)[0..8] % max`
- Removes the pending entry and writes a fulfilled entry containing `caller`, `max`, `server_seed`, and `result`.
- `caller` is the game contract that submitted the request; the request is looked up by `(caller, request_id)`. A caller that did not submit `request_id` gets `RequestNotFound`.
- Each `(caller, request_id)` can only be fulfilled once.
- Emits: `RandomFulfilled { request_id, caller, result, server_seed }` (`request_id` and `caller` are topics).

---

### `get_result(caller: Address, request_id: u64) -> Result<FulfilledEntry, Error>`

Return the fulfilled result for `caller`'s `request_id`.

Returns `RequestNotFound` if the request is still pending, never existed, or belongs to a different caller.

```rust
pub struct FulfilledEntry {
    pub caller:      Address,
    pub max:         u64,
    pub server_seed: BytesN<32>,  // stored for verification
    pub result:      u64,         // always in [0, max - 1]
}
```

---

## Events

| Event | Topics | Data |
|---|---|---|
| `RandomRequested` | `request_id: u64`, `caller: Address` | `max: u64` |
| `RandomFulfilled` | `request_id: u64` | `result: u64`, `server_seed: BytesN<32>` |

---

## Error Codes

| Code | Value | Meaning |
|---|---|---|
| `AlreadyInitialized` | 1 | `init` called more than once |
| `NotInitialized` | 2 | Contract not initialized |
| `NotAuthorized` | 3 | Caller is not admin or oracle |
| `InvalidBound` | 4 | `max < 2` |
| `DuplicateRequestId` | 5 | `request_id` already used (pending or fulfilled) |
| `RequestNotFound` | 6 | No pending request exists for `request_id` |
| `AlreadyFulfilled` | 7 | `fulfill_random` called twice for same `request_id` |
| `UnauthorizedCaller` | 8 | `caller` is not in the whitelist |

---

## Storage

| Key | Storage Type | Description |
|---|---|---|
| `Admin` | `instance()` | Admin address |
| `Oracle` | `instance()` | Oracle address |
| `AuthorizedCaller(addr)` | `persistent()` | Presence flag for whitelisted callers |
| `PendingRequest(id)` | `persistent()` | `PendingEntry { caller, max }` |
| `FulfilledRequest(id)` | `persistent()` | `FulfilledEntry { caller, max, server_seed, result }` |

All persistent entries have TTL bumped to ~30 days (`518_400` ledgers at 5 s/ledger) on every write.

---

## On-Chain Verification

Given a `FulfilledEntry`, anyone can verify correctness without trusting the oracle:

```
preimage = entry.server_seed (32 bytes) || request_id.to_be_bytes() (8 bytes)
digest   = sha256(preimage)
raw      = u64::from_be_bytes(digest[0..8])
expected = raw % entry.max

assert expected == entry.result
```

---

## Integration Pattern for Game Contracts

```
Round lifecycle:
  1. Oracle publishes sha256(server_seed) off-chain (commitment)
  2. game_contract → rng.request_random(game_contract, request_id, max)
  3. oracle        → rng.fulfill_random(oracle, game_contract, request_id, server_seed)
  4. game_contract → rng.get_result(game_contract, request_id) → use entry.result
  5. [optional] anyone verifies result off-chain using the stored server_seed
```

Game contracts must be whitelisted by the admin before they can call `request_random`.

---

## Building and Testing

```bash
# From contracts/random-generator/
cargo build --target wasm32-unknown-unknown --release
cargo test
cargo clippy -- -D warnings
cargo fmt
```

---

## Additional Request Visibility

`get_request_status(caller, request_id)` returns a stable lifecycle snapshot for a caller's request id:

- `Missing` when the id has never been seen.
- `Pending` with the original `caller` and `max`.
- `Fulfilled` with `caller`, `max`, `result`, and `server_seed`.

Duplicate or missing fulfillment attempts also emit `RandomFulfillmentRejected { request_id, caller, reason }` before returning an error, which improves request-trace debugging.

---

## Configuration & Requester Visibility

### `get_config() -> Result<GeneratorConfig, Error>`

Returns a stable snapshot of the generator's operational configuration. This is a read-only, side-effect-free accessor designed for operational tooling.

```rust
pub struct GeneratorConfig {
    pub admin:            Address,
    pub oracle:           Address,
    pub persistent_ttl:   u32,
    pub min_max_bound:    u64,
    pub entropy_version:  Option<String>,
}
```

**Fields:**
- `admin` — Address of the contract administrator
- `oracle` — Address of the oracle authorized to fulfill randomness requests
- `persistent_ttl` — Persistent storage TTL in ledgers (518,400 ≈ 30 days)
- `min_max_bound` — Minimum allowed value for the `max` parameter (always 2)
- `entropy_version` — Current entropy metadata version string, if set

**Extensibility:** The config shape is designed to be extensible. New generator policy fields can be added in future versions without breaking existing consumers.

---

### `get_requester_summary(caller: Address) -> RequesterSummary`

Returns a per-requester sequencing summary showing their request history. This is a deterministic, side-effect-free read operation.

```rust
pub struct RequesterSummary {
    pub caller:           Address,
    pub total_requests:   u64,
    pub pending_count:    u64,
    pub fulfilled_count:  u64,
}
```

**Fields:**
- `caller` — The caller address this summary is for
- `total_requests` — Total number of requests made by this caller (pending + fulfilled)
- `pending_count` — Number of requests currently pending fulfillment
- `fulfilled_count` — Number of requests that have been fulfilled

**Missing-requester behavior:** For callers that have never made requests (or are not authorized), returns a summary with all counts at zero. This allows operational tooling to check any address without error handling.

**Side-effect guarantee:** Multiple calls with the same `caller` always return identical results. The operation performs no writes and does not modify storage TTLs.

---

## Storage

| Key | Storage Type | Description |
|---|---|---|
| `Admin` | `instance()` | Admin address |
| `Oracle` | `instance()` | Oracle address |
| `EntropyMetadata` | `instance()` | Entropy source metadata (optional) |
| `AuthorizedCaller(addr)` | `persistent()` | Presence flag for whitelisted callers |
| `PendingRequest(id)` | `persistent()` | `PendingEntry { caller, max }` |
| `FulfilledRequest(id)` | `persistent()` | `FulfilledEntry { caller, max, server_seed, result }` |
| `RequesterPendingCount(addr)` | `persistent()` | Per-requester pending request counter |
| `RequesterFulfilledCount(addr)` | `persistent()` | Per-requester fulfilled request counter |

All persistent entries have TTL bumped to ~30 days (`518_400` ledgers at 5 s/ledger) on every write.
