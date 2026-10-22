# quest-redeemer

## Public Methods

### `init`
Initialize the quest redeemer.

```rust
pub fn init(env: Env, admin: Address, quest_board: Address, token: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `quest_board` | `Address` |
| `token` | `Address` |

#### Return Type

`Result<(), Error>`

### `set_verifier`
Set the trusted verifier address. Admin only.

```rust
pub fn set_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `verifier` | `Address` |

#### Return Type

`Result<(), Error>`

### `mark_complete`
Record that a player has completed a quest. Verifier only.

```rust
pub fn mark_complete(env: Env, verifier: Address, player: Address, quest_id: u32) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `verifier` | `Address` |
| `player` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`Result<(), Error>`

### `set_pause`
Set the paused state. Admin only.

```rust
pub fn set_pause(env: Env, paused: bool) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `paused` | `bool` |

#### Return Type

`Result<(), Error>`

### `redeem`
Redeem a quest reward for the caller.

```rust
pub fn redeem(env: Env, user: Address, quest_id: u32) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`Result<(), Error>`

### `get_redemption_snapshot`
Returns a complete snapshot of redemption status for a specific user and quest.  # Returns A `RedemptionSnapshot` containing the current status (Eligible, Redeemed, etc.). Handles uninitialized state by returning `None` for config and `Paused` status.

```rust
pub fn get_redemption_snapshot(env: Env, user: Address, quest_id: u32) -> RedemptionSnapshot
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`RedemptionSnapshot`

### `turn_in_queue_summary`
Backwards-compatible alias for the turn-in queue summary accessor.

```rust
pub fn turn_in_queue_summary(env: Env, user: Address, quest_id: u32) -> RedemptionSnapshot
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`RedemptionSnapshot`

### `reward_gap`
Returns how far a quest turn-in is from being claimable.  Zero-state behavior: - Uninitialized or paused contracts return `reward_gap = 1`. - Redeemed quests return `reward_gap = 0`.

```rust
pub fn reward_gap(env: Env, user: Address, quest_id: u32) -> RewardGap
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`RewardGap`

### `has_redeemed`
Checks if a specific redemption has already occurred.

```rust
pub fn has_redeemed(env: Env, user: Address, quest_id: u32) -> bool
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |
| `quest_id` | `u32` |

#### Return Type

`bool`

### `is_paused`
Returns whether redemptions are globally paused.

```rust
pub fn is_paused(env: Env) -> bool
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`bool`

