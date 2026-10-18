# coin-flip

Snapshot of the house's current exposure across all unresolved games.  `max_payout_liability` is the maximum token amount the house must transfer if every active game resolves in the player's favour.  The formula is:  ```text max_payout_liability = total_wagered * (2 * 10_000 - house_edge_bps) / 10_000 ```  The value resets to zero naturally as games are resolved.  No admin action is needed between rounds.

## Public Methods

### `init`
Initialize the coin flip game.  `house_edge_bps`: house edge in basis points (e.g., 250 = 2.5%). The refund timeout for `cancel_stale_bet` is set to `DEFAULT_REFUND_TIMEOUT_LEDGERS`.

```rust
pub fn init(env: Env, admin: Address, rng_contract: Address, token: Address, min_wager: i128, max_wager: i128, house_edge_bps: i128) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `rng_contract` | `Address` |
| `token` | `Address` |
| `min_wager` | `i128` |
| `max_wager` | `i128` |
| `house_edge_bps` | `i128` |

#### Return Type

`Result<(), Error>`

### `place_bet`
Player places a bet. Tokens are transferred into the contract. A randomness request is submitted to the RNG contract.  `side`: 0 = Heads, 1 = Tails.

```rust
pub fn place_bet(env: Env, player: Address, side: u32, wager: i128, game_id: u64) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `player` | `Address` |
| `side` | `u32` |
| `wager` | `i128` |
| `game_id` | `u64` |

#### Return Type

`Result<(), Error>`

### `resolve_bet`
Resolve a game after the oracle has fulfilled the RNG request. Anyone can call this — no auth needed since the outcome is deterministic.

```rust
pub fn resolve_bet(env: Env, game_id: u64) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `game_id` | `u64` |

#### Return Type

`Result<(), Error>`

### `cancel_stale_bet`
Cancel a bet whose randomness was never fulfilled and refund the full wager to the player.  Only the game's player may call this, and only once `RefundTimeoutLedgers` ledgers have passed since `placed_at_ledger` while the RNG request is still unfulfilled. If the RNG result is already available the call fails with `RefundNotYetAvailable`; the game must be settled with `resolve_bet` instead.

```rust
pub fn cancel_stale_bet(env: Env, player: Address, game_id: u64) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `player` | `Address` |
| `game_id` | `u64` |

#### Return Type

`Result<(), Error>`

### `get_game`
View a game's state.

```rust
pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `game_id` | `u64` |

#### Return Type

`Result<Game, Error>`

### `get_recent_games`
Return a bounded page of recent game ids for a player, ordered newest first.

```rust
pub fn get_recent_games(env: Env, player: Address, start: u32, limit: u32) -> Result<PlayerGameHistoryPage, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `player` | `Address` |
| `start` | `u32` |
| `limit` | `u32` |

#### Return Type

`Result<PlayerGameHistoryPage, Error>`

### `house_exposure_snapshot`
Return the current house exposure across all unresolved games.  The snapshot is derived entirely from aggregate counters updated by `place_bet`, `resolve_bet` and `cancel_stale_bet`, so it requires no off-chain scanning. `max_payout_liability` reflects the worst-case payout if every active game is won by the player (after applying the configured house edge). Returns zeroed fields when no games are currently active.

```rust
pub fn house_exposure_snapshot(env: Env) -> Result<HouseExposureSnapshot, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<HouseExposureSnapshot, Error>`

### `fund_house`
Fund the house bankroll. Admin only.

```rust
pub fn fund_house(env: Env, admin: Address, amount: i128) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `amount` | `i128` |

#### Return Type

`Result<(), Error>`

### `withdraw_house`
Withdraw from the house bankroll without dropping below current exposure liability. Admin only.

```rust
pub fn withdraw_house(env: Env, admin: Address, amount: i128) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `amount` | `i128` |

#### Return Type

`Result<(), Error>`

### `house_balance`
Read-only getter for the contract's token balance.

```rust
pub fn house_balance(env: Env) -> Result<i128, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<i128, Error>`

### `set_wager_limits`
Update minimum and maximum wager limits. Admin only.

```rust
pub fn set_wager_limits(env: Env, admin: Address, min_wager: i128, max_wager: i128) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `min_wager` | `i128` |
| `max_wager` | `i128` |

#### Return Type

`Result<(), Error>`

### `set_paused`
Pause or unpause contract operations. Admin only.

```rust
pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `paused` | `bool` |

#### Return Type

`Result<(), Error>`

### `get_config`
Query the complete configuration snapshot of the contract.

```rust
pub fn get_config(env: Env) -> Result<CoinFlipConfig, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<CoinFlipConfig, Error>`

### `is_paused`
Query whether the contract is currently paused.

```rust
pub fn is_paused(env: Env) -> Result<bool, Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |

#### Return Type

`Result<bool, Error>`

