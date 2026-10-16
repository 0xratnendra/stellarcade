# StellarCade — Copilot instructions

The full rules for AI-written changes live in [`AGENTS.md`](../AGENTS.md) at the
repo root, plus [`contracts/AGENTS.md`](../contracts/AGENTS.md),
[`backend/AGENTS.md`](../backend/AGENTS.md) and
[`apps/web/AGENTS.md`](../apps/web/AGENTS.md) for each area. Read them before
suggesting or writing code. The short version:

- Link every GitHub issue the PR closes (related issues may share a PR).
  Edit only the files listed in those issues'
  **Where to Implement (Exact Targets)** sections.
- Never simulate outcomes (`Math.random()` / `randomBytes` game results),
  fabricate transaction hashes, or leave placeholder code that looks real.
  If something can't be built yet, return an honest error.
- Versions: `soroban-sdk` 25.x with `#[contractevent]`; the `stellar` CLI
  (not `soroban`); target `wasm32v1-none`; `@stellar/stellar-sdk` v14
  (`rpc.Server`, not `SorobanRpc`); Next.js 16 in `apps/web`.
- Backend is CommonJS Express (`routes → controllers → services → models`);
  every route needs a `routeDocs` entry, then `npm run openapi:generate`.
- Paste real output from the checks in `AGENTS.md` → *Delivery Standard*
  into the PR template.
