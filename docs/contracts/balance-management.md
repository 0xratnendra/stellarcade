# balance-management

## Public Methods

### `init`
Initialize the contract with an admin. May only be called once.

```rust
pub fn init(env: Env, admin: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |

#### Return Type

`Result<(), Error>`

### `authorize_game`
Add a game contract to the allowlist. Admin only.

```rust
pub fn authorize_game(env: Env, admin: Address, game: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `game` | `Address` |

#### Return Type

`Result<(), Error>`

### `revoke_game`
Remove a game contract from the allowlist. Admin only.

```rust
pub fn revoke_game(env: Env, admin: Address, game: Address) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `admin` | `Address` |
| `game` | `Address` |

#### Return Type

`Result<(), Error>`

### `update_balance`
Update user balance. Only allowlisted game contracts may call this.

```rust
pub fn update_balance(env: Env, caller: Address, user: Address, amount: i128, is_add: bool) -> Result<(), Error>
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `caller` | `Address` |
| `user` | `Address` |
| `amount` | `i128` |
| `is_add` | `bool` |

#### Return Type

`Result<(), Error>`

### `get_balance`
View user balance.

```rust
pub fn get_balance(env: Env, user: Address) -> i128
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |

#### Return Type

`i128`

### `get_account_summary`
Returns a stable account snapshot for backend consumers.  If an account has never been written, `exists` is false and numeric fields are zeroed so unknown and zero-balance-known accounts are distinguishable.

```rust
pub fn get_account_summary(env: Env, user: Address) -> AccountSummary
```

#### Parameters

| Name | Type |
|------|------|
| `env` | `Env` |
| `user` | `Address` |

#### Return Type

`AccountSummary`

