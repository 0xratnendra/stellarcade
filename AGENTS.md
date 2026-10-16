# Repository Agent Standards

This file defines the minimum engineering standards that AI agents must follow
when working in this repository. These rules exist to prevent lint debt, weak
typing, build regressions, and workflow bypasses.

It is read by every AI coding tool contributors use here (Claude Code via
`CLAUDE.md`, Codex, Cursor via `.cursor/rules/`, Copilot via
`.github/copilot-instructions.md`). Area files add rules for their directory:
[`contracts/AGENTS.md`](contracts/AGENTS.md),
[`backend/AGENTS.md`](backend/AGENTS.md) and
[`apps/web/AGENTS.md`](apps/web/AGENTS.md). Read the one for every area you
touch before editing it.

## Working Rules for Pull Requests

Most rejected PRs here were not wrong because the code was bad — they were
wrong because they did something other than what the issue asked, or made
something *look* finished that wasn't. These rules are not optional.

1. **Link every issue the PR closes.** Put one `Closes #<number>` line per
   issue in the PR description. No issue, no PR. Related issues can share a
   PR (e.g. a contract change and the deploy that depends on it), but each
   linked issue's Required Tests and Definition of Done still apply in full.
   Don't bundle unrelated "while I was here" fixes — open a separate issue.
2. **Stay inside the linked issues' targets.** Issues list their files under
   **Where to Implement (Exact Targets)**. Edit only those files, plus the
   test files the issue's **Required Tests** section names. If the work
   genuinely needs another file, stop and say so in the PR (or ask on the
   issue) instead of silently widening scope. Lockfiles change only when the
   issue adds or removes a dependency. Running the test suites can rewrite
   tracked snapshot files (`contracts/*/test_snapshots/`,
   `apps/web/src/components/__snapshots__/`) — on Windows often with only a
   line-ending change. Revert those with `git checkout -- <path>` unless
   your change is meant to update them. Check `git status` before
   committing.
3. **Never fake an outcome.** Do not:
   - decide a game result, payout or winner off-chain (`Math.random()`,
     `crypto.randomBytes`, hardcoded `win`/`heads`) where the issue or the
     surrounding code expects it to come from a contract;
   - fabricate a transaction hash, contract ID, ledger number or signature
     (e.g. `'0x' + randomBytes(32).toString('hex')` — Stellar tx hashes are
     64 hex chars with no `0x` prefix, and they come from a submitted
     transaction, never from a random generator);
   - return hardcoded data, empty structs or zero values from code that
     claims to read real state;
   - leave `todo!()`, `unimplemented!()`, `// TODO: implement`, or a
     function body that only logs, behind a name that suggests it works.

   If the real thing can't be built yet (missing contract method, missing
   env var, no RPC access), make the code **fail loudly** — return an error
   such as `503 NOT_CONFIGURED` or a contract `Error` variant — and say so
   in the PR. An honest error is mergeable; a convincing fake is not.
4. **Tests prove behaviour, not existence.** Every test must fail if the
   feature is removed. A test that only asserts a module loads, or that
   mocks the very function it claims to test, doesn't count.
5. **Fill in the PR template with evidence.** Paste the actual terminal
   output (trimmed to the summary lines) of every check listed under
   *Delivery Standard* below for each area you touched. Writing "tests
   pass" without output, or listing commands you didn't run, gets the PR
   closed.
6. **Don't hand-edit generated files.** `backend/openapi.yaml` is generated
   by `npm run openapi:generate`; `docs/contracts/` by the
   contract-doc-generator; `apps/web/AGENTS.md` by `next dev`.
7. **A PR is finished when every CI check is green, not when it is opened.**
   After pushing, check the PR's CI: `lint-backend`, `lint-contracts`,
   `lint-web`, `test-backend`, `test-web` and `test-contracts`.
   `gh pr checks <number>` shows their status, and
   `gh run view <run-id> --log-failed` shows the errors. If any fail,
   reproduce the failure locally with the matching command under
   *Delivery Standard*, fix it, and push again to the same PR. Repeat until
   all six pass. Maintainers review green PRs, and a red PR is not merged.
   Vercel and CodeRabbit are not part of this.

## Repository Map

| Path | What it is | Tooling |
|---|---|---|
| `contracts/` | Soroban smart contracts. **One Cargo workspace** (`contracts/Cargo.toml`) with an explicit `members` list and an `exclude` list of crates that don't build/lint yet. Status of each crate: [`contracts/STATUS.md`](contracts/STATUS.md). | Rust stable (see `rust-toolchain.toml`; CI pins 1.91.0), `cargo`, `stellar` CLI |
| `backend/` | Express API, **CommonJS** (`require`/`module.exports`). Layers: `src/routes/` → `src/controllers/` → `src/services/` → `src/models/` (Knex). Mounted under `/api`. | npm (own `package-lock.json`, *not* part of the pnpm workspace), Jest + Supertest |
| `apps/web/` | The live frontend: **Next.js App Router** (`app/`) + Tailwind v4 + shadcn primitives. Shared code in `src/`. Package name `@stellarcade/web`. | pnpm workspace, Vitest, Playwright (`e2e/`) |
| `packages/tokens/` | Design tokens consumed by `apps/web` (`@stellarcade/tokens`). | pnpm workspace |
| `tools/` | Standalone dev tools (pnpm workspace members). | per tool |
| `experimental/` | Separate sandbox (`contracts/`, `tools/`, `ui/`). **Not in the Cargo or pnpm workspace and not run by CI.** Nothing in the shipped app may import from it; don't edit it unless the issue targets it. | — |
| `scripts/` | Deploy/setup scripts and hook installers (`setup-hooks.sh`, `setup-hooks.ps1`). | bash / node |
| `docs/` | Project docs; `docs/contracts/` is generated. | — |

## Setup

```bash
# Once per clone — enables .githooks (see Git and Hook Policy below)
git config core.hooksPath .githooks

# Contracts: toolchain + targets come from rust-toolchain.toml automatically
rustup target add wasm32v1-none          # if rustup didn't add it
cargo install --locked stellar-cli       # provides the `stellar` binary

# Backend (npm, run inside backend/)
cd backend && npm install

# Web + packages + tools (pnpm, run from the repo root)
pnpm install --frozen-lockfile
```

Backend runtime needs PostgreSQL and Redis (`docker-compose up -d` starts
both plus the API). Unit/integration tests mock them and run without either.

## Commands by Area

Run these from the repo root unless noted. The *Delivery Standard* section
below lists which ones must pass before you push.

**Contracts** (`contracts/`):

```bash
cd contracts/<crate>
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
# wasm build, same target/flags as CI (run from contracts/):
cd contracts && cargo build -p <package-name> --target wasm32v1-none --release --locked
```

`<package-name>` is the `name` in the crate's `Cargo.toml`, usually
`stellarcade-<crate>` (e.g. `stellarcade-coin-flip`). Cargo commands run
inside a member crate use the workspace's `Cargo.lock` and `target/`.

`stellar contract build` (run in the crate directory) also works for most
crates, but **fails for crates that depend on another contract crate**
(e.g. `coin-flip` → `random-generator`: "symbol multiply defined" / "failed
to load bitcode"), because it forces a single cdylib. Use the `cargo build`
line above — it's what CI runs.

**Backend** (`backend/`):

```bash
cd backend
npm run lint              # ESLint (warnings allowed, errors fail)
npm run openapi:generate  # after changing any routeDocs — rewrites openapi.yaml
npm run openapi:validate  # fails if openapi.yaml is out of date or a route is undocumented
npm test                  # Jest; tests/unit and tests/integration
npm run format            # Prettier
```

**Web** (`apps/web/`, via pnpm filter from the root):

```bash
pnpm --filter @stellarcade/web run lint
pnpm --filter @stellarcade/web run typecheck
pnpm --filter @stellarcade/web run test        # Vitest
pnpm --filter @stellarcade/web run build       # CI runs this too
pnpm --filter @stellarcade/web exec playwright test   # e2e; starts `next dev` itself
```

## Copy These Patterns

Before writing new code, open the closest reference below and match it.

- **Contract with tests:** [`contracts/coin-flip/src/lib.rs`](contracts/coin-flip/src/lib.rs)
  and [`contracts/coin-flip/src/test.rs`](contracts/coin-flip/src/test.rs) —
  `#[contracterror]` enum with an `Overflow` variant, `#[contractevent]`
  events, `require_auth`, instance vs persistent storage with `extend_ttl`,
  checked arithmetic, state written before the payout transfer, and tests
  that register a real Stellar Asset Contract and the real
  `random-generator` contract instead of mocking them.
  [`contracts/random-generator/src/lib.rs`](contracts/random-generator/src/lib.rs)
  is the reference for commit-reveal RNG with in-file tests.
- **Backend route with OpenAPI docs:** [`backend/src/routes/leaderboard.routes.js`](backend/src/routes/leaderboard.routes.js)
  (a `routeDocs` array next to the `router.get(...)` it documents, exported
  as `module.exports.routeDocs`), its controller in
  [`backend/src/controllers/games.controller.js`](backend/src/controllers/games.controller.js),
  and its test [`backend/tests/integration/leaderboard.test.js`](backend/tests/integration/leaderboard.test.js).
- **Web service with tests:** [`apps/web/src/services/freighter-adapter.ts`](apps/web/src/services/freighter-adapter.ts)
  with [`apps/web/src/services/freighter-adapter.test.ts`](apps/web/src/services/freighter-adapter.test.ts);
  for pure logic, [`apps/web/src/utils/fairness-verifier.ts`](apps/web/src/utils/fairness-verifier.ts)
  with [`apps/web/src/utils/fairness-verifier.test.ts`](apps/web/src/utils/fairness-verifier.test.ts).
  Tests sit next to the file they test as `*.test.ts(x)`.

## Versions Models Usually Get Wrong

Check these against the repo, not your training data:

| Thing | Use this | Not this |
|---|---|---|
| Soroban SDK | `soroban-sdk` **25.x** (crates pin `25.0.2` or `25.1.1`; `Cargo.lock` resolves 25.3.x). Copy the version line from a neighbouring crate's `Cargo.toml`. | 20.x/21.x examples (only three excluded crates still pin 21.x) |
| Contract events | `#[contractevent]` structs + `.publish(&env)` | `env.events().publish((topics), data)` — deprecated in SDK 23+, no crate here uses it |
| Contract CLI | `stellar` (`stellar contract build`, `stellar contract deploy`, `stellar keys`) | `soroban` / `soroban-cli` — renamed; some older docs (README, `docs/SETUP.md`, `CONTRIBUTING.md`) still say `soroban`, ignore them |
| Wasm target | `wasm32v1-none` | `wasm32-unknown-unknown` for deployable builds (still installed by `rust-toolchain.toml`, but CI builds `wasm32v1-none`) |
| JS Stellar SDK | `@stellar/stellar-sdk` **v14** (backend: `^14.5.0`). Soroban RPC is `rpc.Server`; Horizon is `Horizon.Server`; generated contract clients are `contract.Client`. | `SorobanRpc.Server` (removed — `SorobanRpc` is `undefined` in v14), `stellar-sdk` / `soroban-client` packages |
| Next.js | **16.x** in `apps/web` (`next@^16.2`), React 19. APIs differ from older versions — read [`apps/web/AGENTS.md`](apps/web/AGENTS.md) and `apps/web/node_modules/next/dist/docs/` first. | Pages Router, Next 13/14 patterns |
| Tailwind | v4 (`@tailwindcss/postcss`, CSS-first config) | `tailwind.config.js` v3 setup |

## Git and Hook Policy

- Never use `git commit --no-verify`.
- Never use `git push --no-verify`.
- Do not bypass, disable, or delete a failing hook. Fix the underlying issue
  instead.
- Direct pushes to `main` are never allowed, for anyone. Always work on a
  feature branch and open a pull request.
- Hooks live under `.githooks/` (version-controlled, not `.git/hooks/`) and
  are enabled via `git config core.hooksPath .githooks`. If
  `git config core.hooksPath` doesn't print `.githooks`, run that command
  before doing anything else — an unset hooksPath means every check below is
  silently skipped, with no error.
- `pre-commit` formats/lints only what's staged (touched `contracts/<crate>/`
  via `cargo fmt`; touched `backend/` via `npm run format && npm run lint -- --fix`).
- `pre-push` runs scoped checks based on what changed since the last push:
  - Any touched `contracts/<crate>/` — `cargo fmt --check`,
    `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`,
    plus a contract-doc sync check if `contracts/` or `docs/contracts/`
    changed.
  - Any touched `backend/` — `npm run lint`, `npm run openapi:validate`,
    `npm test`.
  - Any touched `apps/web/` or `packages/tokens/` — `pnpm --filter
    @stellarcade/web run lint`, `run typecheck`, `run test`.
- Confirm every applicable check above passes locally before pushing. If a
  check cannot be satisfied, report the blocker clearly instead of claiming
  the task is complete.

## Delivery Standard

Do not treat a task as complete until every check relevant to what you
changed passes:

- Contracts (run from inside the specific `contracts/<crate>/` directory):
  `cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
- Backend: `cd backend && npm run lint && npm run openapi:validate && npm test`
- Web: `pnpm --filter @stellarcade/web run lint && pnpm --filter @stellarcade/web run typecheck && pnpm --filter @stellarcade/web run test`

CI additionally lints/tests the **entire** contracts workspace (not just
touched crates), builds the web app, and runs Playwright e2e tests. Those
aren't required locally before every push, but a change that would obviously
break them (an unresolvable import, a broken route, a change that affects
other crates) should still be caught by you before pushing — when in doubt,
`cd contracts && cargo clippy --workspace --locked -- -D warnings` matches CI
exactly, it's just slower than the per-touched-crate hook check.

## Commit Message Standard

- Use the imperative mood in the subject line (e.g. `Fix settlement race`,
  not `Fixed` or `Fixes`).
- Keep the subject line to 50 characters or fewer where practical.
- Do not end the subject line with a period.
- Only add a body when it conveys information the subject line can't —
  don't restate the subject.
