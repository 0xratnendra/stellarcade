# Flash Loan Escrow

An experimental Soroban contract implementing an arcade liquidity flash
escrow. Liquidity providers deposit tokens and earn a share of flash loan
fees; arbitrage bots and market makers borrow instantly, uncollateralized,
for exactly one transaction, and must repay the loan plus fee before the
call returns or the entire transaction reverts.

This is an isolated, self-contained experimental contract. It does not
depend on, and is not depended on by, any contract under `contracts/`.

## Design

- **Borrower callback interface** — `flash_loan` calls the borrower
  contract's own `execute_operation(token, amount, fee, params)`
  entrypoint after transferring `amount` to it. The borrower is
  responsible for repaying `amount + fee` back to this contract before
  the callback returns.
- **Repayment enforcement** — this contract checks its own token balance
  before and after the callback, requiring it to have grown by at least
  `fee`. It does **not** trust the callback's own boolean return value:
  a borrower that returns `true` without actually transferring the funds
  back is still rejected (`LoanNotRepaid`), which then causes the whole
  `flash_loan` call to error out. Because Soroban transactions are
  all-or-nothing, this also rolls back any partial repayment or other
  state change the callback itself made.
- **Fee accounting** — uses a reward-per-share accumulator (the same
  shape as a yield-bearing vault's index) rather than iterating every
  liquidity provider on every loan: each repaid loan bumps a single
  global accumulator by `fee * ACC_PRECISION / total_principal`, and a
  provider's newly-earned fees since their last checkpoint are computed
  in O(1) from the accumulator delta times their principal. A provider's
  fee balance is always settled (checkpointed) before their own principal
  changes, so depositing or withdrawing never loses already-earned,
  unclaimed fees, and a provider who joins after a loan does not
  retroactively earn a share of it.
- **Fee rate** — configured at `initialize` and adjustable afterward via
  admin-only `set_fee_bps`.

## Storage layout

- `instance()`: `Admin`, `Token`, `FeeBps`, `TotalPrincipal`,
  `FeeAccumulator` — small, fixed-size configuration.
- `persistent()`: `ProviderPrincipal`, `ProviderFeeAccChkpt`, and
  `ProviderFeesEarned`, each keyed by provider and bumped on every write.

## Interface

```rust
fn initialize(env: Env, admin: Address, token: Address, fee_bps: u32) -> Result<(), Error>;
fn set_fee_bps(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error>;
fn deposit_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), Error>;
fn withdraw_liquidity(env: Env, provider: Address, amount: i128) -> Result<(), Error>;
fn claim_fees(env: Env, provider: Address) -> Result<i128, Error>;
fn flash_loan(env: Env, borrower_contract: Address, token: Address, amount: i128, params: Vec<Val>) -> Result<(), Error>;
fn get_fee_bps(env: Env) -> u32;
fn get_provider_principal(env: Env, provider: Address) -> i128;
fn get_provider_fees_earned(env: Env, provider: Address) -> i128;
```

`set_fee_bps`, `deposit_liquidity`, `withdraw_liquidity`, and
`claim_fees` all enforce `require_auth()` on the caller they act on
behalf of; `set_fee_bps` additionally requires the caller to match the
configured `Admin`. `flash_loan` itself takes no caller parameter (there
is nothing to authorize on the escrow's side beyond the borrower
contract's own callback doing whatever authorization it needs).

### Errors

`AlreadyInitialized`, `NotInitialized`, `InvalidInput`,
`InsufficientLiquidity`, `LoanNotRepaid`, `BorrowerCallbackFailed`,
`NoDeposit`.

## Usage (pseudo-flow)

```text
initialize(admin, token, fee_bps=30)  // 0.3%
deposit_liquidity(provider_a, 75_000 XLM)
deposit_liquidity(provider_b, 25_000 XLM)

flash_loan(arbitrage_bot, token, amount=10_000 XLM, params)
// -> transfers 10_000 to arbitrage_bot
// -> calls arbitrage_bot.execute_operation(token, 10_000, fee=30, params)
// -> arbitrage_bot must transfer 10_030 back before returning
// -> provider_a earns 75% of the 30 fee, provider_b earns 25%

claim_fees(provider_a)  // withdraws provider_a's accrued fee share
```

## Testing

```bash
cargo test --manifest-path experimental/contracts/flash-loan-escrow/Cargo.toml
```

Build for wasm (optional, requires the `wasm32-unknown-unknown` target):

```bash
rustup target add wasm32-unknown-unknown
cargo build --manifest-path experimental/contracts/flash-loan-escrow/Cargo.toml \
  --target wasm32-unknown-unknown --release
```
