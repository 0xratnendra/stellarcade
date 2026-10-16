# Contracts — Agent Rules

Applies to everything under `contracts/`. The root [`AGENTS.md`](../AGENTS.md)
still applies (PR rules, delivery checks, versions).

## Layout

- `contracts/Cargo.toml` is a **Cargo workspace**. A crate is built, linted
  and tested by CI only if it is in `members`. Crates in `exclude` don't
  build or lint cleanly yet; the comments in that list say why.
- Don't add a crate to `members` (or move one out of `exclude`) unless your
  issue asks for it, and then only once `cargo clippy --all-targets
  --all-features -- -D warnings` and `cargo test` pass for it. Re-add crates
  one at a time.
- New crates: copy `coin-flip/Cargo.toml` (package name
  `stellarcade-<crate>`, `crate-type = ["cdylib", "rlib"]`, `soroban-sdk`
  25.x as a dependency and again with `features = ["testutils"]` under
  `[dev-dependencies]`) and add the crate to `members`. Don't put a
  `[profile.release]` in the crate — the workspace's profile applies.
- Per-crate status (implemented / partial / stub): [`STATUS.md`](STATUS.md).
  It is a heuristic; read the code before trusting a label.

## Commands

```bash
cd contracts/<crate>
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test

# CI-equivalent whole-workspace checks (slower), from contracts/:
cargo clippy --workspace --locked -- -D warnings
cargo test --workspace --locked
cargo build -p stellarcade-<crate> --target wasm32v1-none --release --locked
```

If you change a contract's public interface, regenerate the docs CI checks:

```bash
cargo run --package stellarcade-contract-doc-generator --manifest-path contracts/contract-doc-generator/Cargo.toml
```

(run from the repo root) and commit the resulting `docs/contracts/` changes.

## Conventions

Reference implementation: [`coin-flip/src/lib.rs`](coin-flip/src/lib.rs) and
[`coin-flip/src/test.rs`](coin-flip/src/test.rs).

- **`#![no_std]`** in every contract `lib.rs`. No `std`, no `println!`.
- **Authorization.** Call `require_auth()` on the `Address` that is acting —
  the player for player actions, the stored admin for admin actions — before
  any state change. Load the admin from storage and compare; never trust an
  `admin: Address` argument on its own.
- **Storage tiers.**
  - `env.storage().instance()` — contract-lifetime config: admin, token
    address, linked contract addresses, limits, fees.
  - `env.storage().persistent()` — per-user / per-game / per-round records.
    Call `extend_ttl` after writing them (see `coin-flip`).
  - `env.storage().temporary()` — only for data that may safely vanish.
  Key everything through a `#[contracttype] enum DataKey`.
- **Arithmetic.** Use `checked_add` / `checked_sub` / `checked_mul` /
  `checked_div` on token amounts and counters, mapping `None` to an
  `Error::Overflow` variant. Never `+`/`*` on `i128` amounts. The release
  profile also sets `overflow-checks = true`; that's a backstop, not a
  substitute.
- **Reentrancy / double-spend.** Write the "already paid" state (status
  enum, `claimed = true`, removed balance) to storage **before** calling
  `TokenClient::transfer` or any other contract. Check that flag at the top
  of the function and return an error if it is set.
- **Errors.** One `#[contracterror] #[repr(u32)] pub enum Error` per
  contract. It is **append-only**: never renumber, reorder or reuse a
  discriminant, because clients and deployed contracts match on the number.
  Add new variants at the end with the next free value. Return
  `Result<_, Error>`; don't `panic!` or `unwrap()` on user-controlled input.
- **Events.** Define `#[contractevent]` structs (with `#[topic]` fields) and
  emit with `.publish(&env)`. Don't use `env.events().publish(...)`.
- **Randomness.** No contract derives outcomes from ledger timestamp,
  sequence or any caller-supplied value alone. Games get randomness from the
  `random-generator` contract (commit-reveal), as `coin-flip` does.
- **Cross-contract calls.** Use the other crate's generated client (e.g.
  `stellarcade_random_generator::RandomGeneratorClient`) via a path
  dependency, and store the callee's address in instance storage at init.
  Such crates build with `cargo build -p ... --target wasm32v1-none`, but
  not with `stellar contract build` (duplicate exported symbols).

## Tests

- Tests live **in the crate**: either `#[cfg(test)] mod test;` with
  `src/test.rs` (preferred, like `coin-flip`) or an inline
  `#[cfg(test)] mod test { ... }` in `lib.rs` (like `random-generator`).
  Not in a separate test crate.
- Use `soroban_sdk::testutils`. Register real dependencies
  (`env.register_stellar_asset_contract_v2`, `env.register(OtherContract, ())`)
  rather than stubbing them. `env.mock_all_auths()` is fine for the happy
  path, but add at least one test proving an unauthorized caller fails.
- Every error variant your change adds or touches needs a test that
  triggers it (`try_<method>` + `assert_eq!(..., Err(Ok(Error::X)))`).
- Money-moving functions need tests asserting the actual token balances
  before and after, and a test that a second claim/resolve is rejected.
- `test_snapshots/` is gitignored — don't add new snapshot files. Some
  older ones (e.g. `coin-flip/test_snapshots/`) are still tracked and get
  rewritten by `cargo test`; revert them unless your change alters them.

## Deploying

Use the `stellar` CLI (`stellar contract deploy`, `stellar keys`), never
`soroban`. Build the wasm with the `cargo build` command above (output in
`contracts/target/wasm32v1-none/release/`). `scripts/deploy-contracts.sh` still calls
the old `soroban` CLI — don't copy its commands. Never commit secret keys or
seed phrases; use a `stellar keys` identity name.
