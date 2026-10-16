# Backend — Agent Rules

Applies to everything under `backend/`. The root [`AGENTS.md`](../AGENTS.md)
still applies (PR rules, delivery checks, versions).

## Stack

- Node.js + Express 4, **CommonJS only** (`require` / `module.exports`). No
  `import`/`export`, no TypeScript.
- npm with its own `package-lock.json`. This directory is **not** part of
  the pnpm workspace — run `npm install` here, never `pnpm add`.
- Knex (PostgreSQL in production, in-memory SQLite in tests), Redis,
  `@stellar/stellar-sdk` v14 (`Horizon.Server`, `rpc.Server`; there is no
  `SorobanRpc` export in v14).

## Layers

`src/routes/` → `src/controllers/` → `src/services/` → `src/models/`

- **Routes** declare paths, middleware (`auth.middleware.js`,
  `rate-limit.middleware.js`, express-validator + `validation.middleware.js`)
  and a `routeDocs` array. Nothing else.
- **Controllers** parse/validate request input, call one service, send the
  response, and pass every error to `next(error)`.
- **Services** hold business logic and Stellar/contract calls.
- **Models** own Knex queries. A few older files (`game.service.js`,
  `health.service.js`, `wallet.controller.js`) import `config/database`
  directly — don't copy that; put new queries in a model.
- New routers are mounted in `src/routes/index.js`; everything is served
  under `/api`.

Reference: [`src/routes/leaderboard.routes.js`](src/routes/leaderboard.routes.js),
[`src/controllers/games.controller.js`](src/controllers/games.controller.js),
[`tests/integration/leaderboard.test.js`](tests/integration/leaderboard.test.js).

## OpenAPI

Every `router.<method>(path, ...)` must have a matching `{ method, path }`
entry in that file's `const routeDocs = [...]`, exported with
`module.exports.routeDocs = routeDocs;`. `scripts/openapi.js` fails on a
route with no doc _and_ on a doc with no route. After changing routes:

```bash
npm run openapi:generate   # rewrites openapi.yaml — commit it
npm run openapi:validate   # what CI runs
```

Never edit `openapi.yaml` by hand.

## Errors

- Throw (or `next()`) an `Error` with `statusCode` and a stable
  `UPPER_SNAKE_CASE` `code`. `src/middleware/errorHandler.middleware.js`
  turns it into the standard envelope
  `{ error: { message, code, status, correlationId } }`. Don't build your
  own error JSON in controllers.
- For errors a service raises in more than one place, define a named class
  like those in [`src/services/auth.service.js`](src/services/auth.service.js)
  (`class InvalidSignatureError extends Error` setting `name`, `statusCode`,
  `code`) and export it.
- When something isn't configured or can't reach the network, return an
  honest error (`503`, `code: '..._NOT_CONFIGURED'` / `..._UNAVAILABLE`).
  Never fall back to fake data, a random outcome, or a made-up
  `tx_hash`. Transaction hashes come from a submitted Stellar transaction
  (64 hex chars, no `0x`).

## Style

Enforced by `.eslintrc.js` and `.prettierrc`:

- single quotes, semicolons, 2-space indent, 100-char lines, LF endings,
  ES5 trailing commas;
- `no-unused-vars` is an error — prefix intentionally unused args/vars with
  `_` (e.g. `(err, req, res, _next)`);
- `no-console` warns — use `require('../utils/logger')` instead.

Run `npm run format` then `npm run lint` before committing (the pre-commit
hook does both whenever a backend file is staged).

**Windows:** `npm run format` is `prettier --write .`, so with
`core.autocrlf=true` it rewrites line endings in _every_ backend file. They
then show as modified with no real change (`git diff --ignore-cr-at-eol` is
empty). Don't stage them — `git add` only the files your issue targets,
never `git add -A` / `git add .`.

## Tests

- Jest + Supertest. `jest.config.js` picks up `tests/**/*.test.js`.
- `tests/unit/` — services, models, utils in isolation.
- `tests/integration/` — HTTP behaviour: mount the router on a bare
  `express()` app with `supertest`, mock `src/config/database` and
  `src/config/redis` with `jest.mock` (see `leaderboard.test.js`).
- Name files `<area>.<behaviour>.test.js` (e.g. `wallet.balance.test.js`).
- Assert on status codes **and** response bodies, including the error
  `code` for failure paths. Don't add `placeholder.test.js`-style tests that
  assert nothing.
- Schema changes go in a new Knex migration under `migrations/`; don't edit
  an existing migration.

```bash
npm test           # full suite with coverage
npx jest tests/integration/leaderboard.test.js   # one file
```
