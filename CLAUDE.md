# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The rules shared by every AI tool — PR scope, no faked outcomes, commands, reference files and version pins — live in `AGENTS.md` (imported below). Area rules: `contracts/AGENTS.md`, `backend/AGENTS.md`, `apps/web/AGENTS.md`.

@AGENTS.md

## CRITICAL RULE — GitHub Account Changes

**NEVER make any changes to GitHub accounts, organizations, or repository settings without explicit written confirmation from the user first.** This includes:
- GitHub organization profile settings (name, description, location, URL, etc.)
- GitHub account or profile settings
- Repository settings, permissions, or access control via API or otherwise

Always show the user exactly what will be changed and wait for a clear "yes, do it" before proceeding. No exceptions.

## Project Overview

**StellarCade** is a decentralized arcade gaming platform on the Stellar blockchain using Soroban smart contracts. The project has three main components:
- **Smart Contracts** (Rust/Soroban) — game logic and on-chain state
- **Backend API** (Node.js/Express) — REST API connecting the frontend to the blockchain
- **Frontend** (`apps/web`, Next.js App Router) — the live web app: landing page, game lobby, portfolio, profile, fairness verifier (`/verify`), account hygiene (`/cleanup`), and project info (`/about`). Built on Tailwind v4 + shadcn/21st.dev component primitives. The original Vite frontend (`frontend/`) was migrated here and removed — see `apps/web/MIGRATION.md` for the migration record.

The core game contracts (coin-flip, prize-pool, random-generator) contain real logic, not stubs. For the current, per-crate classification (implemented / partial / stub) see [`contracts/STATUS.md`](contracts/STATUS.md).

## Smart Contract Commands

All contracts are members of one **Cargo workspace**, `contracts/Cargo.toml` (shared `Cargo.lock`, `target/` and release profile). Crates in its `exclude` list don't build or lint cleanly yet and aren't checked by CI. Cargo commands can be run from `contracts/` or from inside a member crate.

```bash
# Per crate (from contracts/<crate>)
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
stellar contract build            # stellar CLI, not `soroban`; fails for crates depending on another contract crate (coin-flip) — use the cargo build below

# Whole workspace, as CI runs it (from contracts/)
cargo clippy --workspace --locked -- -D warnings
cargo test --workspace --locked
cargo build -p stellarcade-<crate> --target wasm32v1-none --release --locked
```

## Backend Commands

```bash
cd backend

npm install           # Install dependencies
npm run dev           # Development server with hot reload (nodemon)
npm start             # Production server
npm test              # Run tests (Jest + Supertest)
npm run test:watch    # Tests in watch mode
npm run lint          # ESLint
npm run format        # Prettier --write .
npm run migrate       # Knex database migrations
```

## Infrastructure

```bash
docker-compose up -d   # Start PostgreSQL 15, Redis 7, and Backend API
docker-compose down    # Stop all services
```

Required backend environment variables: `NODE_ENV`, `PORT`, `DATABASE_URL` (or `DB_HOST/PORT/USER/PASSWORD/NAME`), `REDIS_URL`, `JWT_SECRET`.

## Architecture

### Smart Contracts (`contracts/`)

Core contracts (status is from [`contracts/STATUS.md`](contracts/STATUS.md) — check there, it is kept more current than this table):

| Contract | Status | Purpose |
|---|---|---|
| `access-control` | Partial — real RBAC logic, no tests | Role-based access (ADMIN, OPERATOR, PAUSER, GAME roles) |
| `pattern-puzzle` | Partial — 13 tests, open TODOs | Commit-reveal knowledge game |
| `prize-pool` | Partial — real logic, no tests | Prize pool management and fee distribution |
| `random-generator` | Implemented — 32 tests | Provably fair RNG (oracle server seed, pre-committed hash, on-chain verifiable result) |
| `coin-flip` | Real logic + 20 tests in `src/test.rs` (STATUS.md's scan only counts `lib.rs`, so it lists this as partial with zero tests) | 50/50 bet game using RandomGenerator; the reference contract |
| `shared` | Present | Common types/utilities shared across contracts |

**Contract patterns to follow** (full list in `contracts/AGENTS.md`; reference: `contracts/coin-flip`):
- All contracts use `#![no_std]` (Soroban requirement)
- Authorization via `Address::require_auth()` on all caller-sensitive functions
- Use `instance()` storage for contract-lifetime data, `persistent()` for per-user/per-round data
- Emit events with `#[contractevent]` structs and `.publish(&env)` (soroban-sdk 25.x) — not `env.events().publish()`
- Use safe arithmetic (`checked_add`, `checked_div`) with explicit `Overflow` error variants
- Set reentrancy guard (e.g., `Claimed` flag) **before** external token transfers
- `#[contracterror]` enums are append-only — never renumber variants
- Release profile lives in the workspace `contracts/Cargo.toml`: `opt-level = "z"`, `overflow-checks = true`, `panic = "abort"`, `lto = true`

### Backend (`backend/src/`)

Express app using CommonJS (`require`/`module.exports`). Routes mount under `/api`:
`/api/auth`, `/api/games`, `/api/users`, `/api/wallet`, `/api/leaderboard`, `/api/quests`, `/api/tournaments`, `/api/webhook` (see `src/routes/index.js`). Every route documents itself in a `routeDocs` array that generates `backend/openapi.yaml` (`npm run openapi:generate`; CI runs `npm run openapi:validate`).

Key layers: `routes/` → `controllers/` → `services/` → `models/` (Knex ORM)

Infrastructure connections: `config/database.js` (PostgreSQL, pool min:2 max:10), `config/redis.js`, `config/stellar.js`.

Auth middleware (`middleware/auth.middleware.js`) expects a Bearer JWT (HS256).

**Backend code style:** single quotes, semicolons, 2-space indent, 100-char line width, LF endings. `no-unused-vars` errors except `^_` prefixed vars.

## CI/CD

GitHub Actions runs on push/PR to `main` or `develop`:
- **`test-backend.yml`**: lint + `npm run openapi:validate` + `npm test`
- **`test-contracts.yml`**: whole-workspace wasm build (`wasm32v1-none`), `cargo test --workspace --locked`, and a `docs/contracts/` sync check
- **`test-web.yml`**: `apps/web` typecheck, Vitest, `next build`, Playwright e2e
- **`lint.yml`** (all PRs): backend ESLint, `cargo clippy --workspace --locked -- -D warnings`, web ESLint

## Testing

**Contracts:** Tests live in the crate — `src/test.rs` behind `#[cfg(test)] mod test;` (e.g. coin-flip) or inline in `src/lib.rs` (e.g. random-generator) — using `soroban-sdk` testutils. `test_snapshots/` is gitignored.

**Backend:** Jest with Supertest. Test directories: `tests/unit/` and `tests/integration/` (26 suites).

**Web:** Vitest, with `*.test.ts(x)` next to the source file; Playwright specs in `apps/web/e2e/`.

## Deployment Scripts

The `scripts/` directory contains: `deploy-contracts.sh`, `generate-keys.js`, `seed-database.js`, `setup-testnet.sh`, plus `setup-hooks.sh` / `setup-hooks.ps1`. `deploy-contracts.sh` still uses the old `soroban` CLI; use `stellar contract deploy` instead of copying it.
