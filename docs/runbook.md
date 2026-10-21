# StellarCade Incident Runbook

> **Audience:** on-call operators for the backend (API, oracle worker, indexer
> worker) and the `coin-flip` / `random-generator` contracts on testnet.
> **Scope:** the six incidents below. For exploit triage and severity
> classification see [EXPLOIT_RESPONSE_RUNBOOK.md](EXPLOIT_RESPONSE_RUNBOOK.md);
> for how the backend is hosted see [deploy-backend.md](deploy-backend.md).
> **Last verified:** testnet, against the contracts in this repository
> (`contracts/coin-flip`, `contracts/random-generator`), stellar CLI 25.1.0.

---

## Placeholders used in every command

| Placeholder | Where it comes from |
| --- | --- |
| `$API` | Deployed API base URL, e.g. `https://<your-render-service>.onrender.com/api` (see [deploy-backend.md](deploy-backend.md)) |
| `$NETWORK` | `testnet` |
| `$ADMIN` | `stellar keys address admin` (the identity in `scripts/setup-testnet.sh`) |
| `$ORACLE` | `stellar keys address oracle` |
| `$COIN_FLIP_ID`, `$RNG_ID` | `jq -r '.contracts.coinFlip' deployments/testnet.json`, `jq -r '.contracts.randomGenerator' deployments/testnet.json` |
| `$STROOPS` | Integer token amounts, 7 decimals: 1 XLM = `10000000` |

All `stellar contract invoke` commands are copied from
`scripts/deploy-contracts.sh` and the contracts' own `#[contractimpl]`
functions.

### First call in any incident: health

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$API/health"       # liveness: 200
curl -sS "$API/health/deep" | jq                                # 200 only when everything is healthy
```

`/health/deep` returns `200` with `status: "healthy"` when
`dependencies.db`, `dependencies.redis`, `dependencies.stellar`, `soroban`
and both `contracts.coinFlip` / `contracts.randomGenerator` are healthy, and
`503` (`status: "degraded"` or `"unhealthy"`) otherwise. It never caches
(`Cache-Control: no-store`).

Useful reads that almost every incident needs:

```bash
# Seed commitment queue depth (random-generator)
stellar contract invoke --id "$RNG_ID" --source "$ADMIN" --network "$NETWORK" -- get_commitment_queue_len

# Is coin-flip paused?  (is_paused -> true | false)
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" -- is_paused

# One round: resolved / refunded / payout  (get_game --game_id <u64>)
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" -- get_game --game_id <GAME_ID>

# Oracle fee balance (Horizon); fund with: stellar keys fund oracle --network "$NETWORK"
curl -sS "https://horizon-testnet.stellar.org/accounts/$ORACLE" | jq '.balances[].balance'
```

Worker logs:

```bash
docker compose logs -f backend          # local / compose
# Render: Dashboard → <service> → Logs (both workers log from the same process)
```

Workers are enabled with `ORACLE_ENABLED=true` and `INDEXER_ENABLED=true`;
both read `SOROBAN_RPC_URL` from the backend environment and store their
event cursor in the `worker_cursors` table (`name = 'oracle' | 'indexer'`).

---

## 1. Oracle stopped or lagging

**Symptoms**

- Rounds stay `pending`: `get_game --game_id <id>` shows `resolved: false`
  long after the bet, or `GET $API/games/recent` shows only `pending` rows.
- `get_commitment_queue_len` is `0` (or falling below `ORACLE_MIN_QUEUE`,
  default `20`) — `request_random` then fails with `NoCommitmentAvailable`
  and new bets are rejected.
- Backend logs show `oracle worker` errors, or no oracle log lines at all.

**Steps**

1. `curl -sS "$API/health/deep" | jq '{status, soroban, contracts}'` — if
   `soroban` is unhealthy, go to incident 6 first (the worker cannot poll
   events without RPC).
2. Check the queue and the stuck round (commands above). Queue `0` with a
   stuck round = oracle not running or not funded.
3. Confirm the worker is on: the process env must contain
   `ORACLE_ENABLED=true`, `ORACLE_SECRET_KEY`, `RANDOM_GENERATOR_CONTRACT_ID`,
   `COIN_FLIP_CONTRACT_ID`.
4. Restart the service (Render: *Restart*; local: `docker compose restart
   backend`). The worker resumes from its saved cursor — it does not replay
   or skip events.
5. Check the oracle account can still pay fees:
   `curl -sS "https://horizon-testnet.stellar.org/accounts/$ORACLE" | jq '.balances[].balance'`.
   Below ~1 XLM: `stellar keys fund oracle --network testnet` (testnet
   friendbot) and restart again.
6. If the queue is empty it refills automatically on the next poll
   (`ORACLE_MIN_QUEUE` commitments are generated and `commit_seeds` is
   called). To refill by hand:

```bash
stellar contract invoke --id "$RNG_ID" --source oracle --network "$NETWORK" \
  -- commit_seeds --oracle "$ORACLE" \
  --commitments '["<sha256-of-seed-1>", "<sha256-of-seed-2>", "<sha256-of-seed-3>"]'
```

**Resolved when**

- `get_commitment_queue_len` ≥ `ORACLE_MIN_QUEUE`;
- the stuck round returns `resolved: true` from `get_game`, and appears in
  `GET $API/games/recent`;
- `/health/deep` is `200 healthy`.

---

## 2. Oracle key compromised

**Symptoms:** the oracle secret (`ORACLE_SECRET_KEY`) leaked — a commit, a
log line, an exposed `.env`, a former contractor's laptop.

**What a compromised oracle key can and cannot do**

- It **cannot** change the outcome of a round whose commitment is already in
  the queue: `fulfill_random` rejects any seed where
  `sha256(server_seed) != pending.commitment` (`SeedCommitmentMismatch`), and
  without the original preimage the attacker cannot fulfil those rounds at all.
- It **can** stall rounds (never reveal → players refund via
  `cancel_stale_bet`), fill the queue with seeds it knows, and refuse to
  cooperate. Treat it as an incident, not a catastrophe, but rotate it.

**The hard fact:** `random-generator` has **no oracle rotation function**.
`init(env, admin, oracle)` runs once (`AlreadyInitialized`), and
`DataKey::Oracle` has no setter; `coin-flip` stores its `rng_contract` the
same way in `init`. Rotating the on-chain oracle address therefore means
**redeploying the stack** (the commands are `scripts/deploy-contracts.sh`'s).

**Steps**

1. Stop new bets immediately:

```bash
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" \
  -- set_paused --admin "$ADMIN" --paused true
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" -- is_paused   # true
```

2. Generate and fund the replacement identity:

```bash
stellar keys generate oracle_v2 --fund --network testnet
stellar keys address oracle_v2        # becomes the new $ORACLE
```

3. Redeploy with the new oracle wired in (copy of
   `scripts/deploy-contracts.sh`, run from the repo root):

```bash
ADMIN_ADDR=$(stellar keys address admin)
ORACLE_ADDR=$(stellar keys address oracle_v2)

RNG_ID=$(stellar contract deploy --wasm contracts/target/wasm32v1-none/release/stellarcade_random_generator.wasm --source admin --network testnet)
stellar contract invoke --id "$RNG_ID" --source admin --network testnet -- init --admin "$ADMIN_ADDR" --oracle "$ORACLE_ADDR"

COIN_FLIP_ID=$(stellar contract deploy --wasm contracts/target/wasm32v1-none/release/stellarcade_coin_flip.wasm --source admin --network testnet)
stellar contract invoke --id "$RNG_ID" --source admin --network testnet -- authorize --admin "$ADMIN_ADDR" --caller "$COIN_FLIP_ID"
stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- init \
  --admin "$ADMIN_ADDR" --rng_contract "$RNG_ID" \
  --token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --min_wager 10000000 --max_wager 1000000000 --house_edge_bps 250
```

4. Re-commit a seed batch **before** reopening (queue must be non-empty or
   every bet fails), then fund the house:

```bash
stellar contract invoke --id "$RNG_ID" --source oracle_v2 --network testnet \
  -- commit_seeds --oracle "$ORACLE_ADDR" \
  --commitments '["<sha256-of-seed-1>", "<sha256-of-seed-2>", "<sha256-of-seed-3>"]'
stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet \
  -- fund_house --admin "$ADMIN_ADDR" --amount 10000000000
```

5. Update the backend secrets (platform secret store, never committed):
   `ORACLE_SECRET_KEY=$(stellar keys secret oracle_v2)`,
   `RANDOM_GENERATOR_CONTRACT_ID=$RNG_ID`, `COIN_FLIP_ID`/`COIN_FLIP_CONTRACT_ID=$COIN_FLIP_ID`,
   and the same IDs in the web app (`NEXT_PUBLIC_*`). Restart.
6. Unpause:

```bash
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" \
  -- set_paused --admin "$ADMIN" --paused false
```

**Resolved when:** `is_paused` → `false`, `get_commitment_queue_len` > 0,
`GET $API/health/deep` is healthy with the *new* contract IDs, and a test
round resolves end to end. Old contract IDs stay paused; rounds already
placed there follow the refund path (incident 4).

---

## 3. House bankroll low

**Symptoms:** `place_bet` fails with `Error(Contract, #13)`
(`InsufficientHouseLiquidity`) — the contract requires
`balance + wager ≥ (total active wager + wager) × (2 − house_edge)` — or
`withdraw_house` fails with the same error.

**Steps**

```bash
# What the house holds, and what it already owes unresolved rounds
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" -- house_balance
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" -- house_exposure_snapshot

# Top up (amount in stroops; 100 XLM = 1000000000)
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" \
  -- fund_house --admin "$ADMIN" --amount 1000000000
```

`fund_house` transfers from the admin account, so the admin must hold at
least that much XLM. Never use `withdraw_house` to "fix" a low bankroll; it
is refused while `balance − amount < max_payout_liability`.

**Resolved when:** `house_balance` covers `house_exposure_snapshot`'s
`max_payout_liability` plus headroom, and a 1-XLM test bet is accepted.

---

## 4. Contract bug (coin-flip)

**Symptoms:** a reproducible fault in payouts, resolution or refunds.

**Steps**

1. Pause new bets (players can still refund and rounds already placed can
   still resolve — `set_paused` only blocks `place_bet`):

```bash
stellar contract invoke --id "$COIN_FLIP_ID" --source "$ADMIN" --network "$NETWORK" \
  -- set_paused --admin "$ADMIN" --paused true
```

2. Tell affected players the refund path, in exactly these terms:
   - the round is refunded only if the oracle **never** fulfils it — once
     `get_result` succeeds, `cancel_stale_bet` returns
     `RefundNotYetAvailable (#14)` and the round must settle normally;
   - after `RefundTimeoutLedgers` ledgers (17,280 ≈ 24 h at ~5 s/ledger)
     from `placed_at_ledger`, the player calls:

```bash
stellar contract invoke --id "$COIN_FLIP_ID" --source <player_identity> --network "$NETWORK" \
  -- cancel_stale_bet --player <PLAYER_ADDRESS> --game_id <GAME_ID>
```

   A refunded game can never be resolved (`resolve_bet` returns
   `GameRefunded (#15)`), so nobody can be paid twice.
3. Fix, rebuild (`cargo build -p stellarcade-coin-flip --target
   wasm32v1-none --release --locked`), redeploy, re-init, re-fund
   (incident 2, step 3 is the full sequence), update contract IDs in
   backend + web env, then unpause the new deployment.

**Resolved when:** `is_paused` → `false` on the healthy deployment,
`/health/deep` healthy with the new ID, and one full round (bet → resolve)
succeeds.

---

## 5. Indexer behind or missing rounds

**Symptoms:** `GET $API/games/recent`, history or leaderboards miss on-chain
rounds; logs show `getEvents` failing with a cursor/`startLedger` error.

**Facts:** the indexer resumes from `worker_cursors.name = 'indexer'` and
polls `bet_placed` / `bet_resolved`. If that cursor is older than the RPC
provider's event retention, polling fails and **there is no automatic
recovery in the backend yet** — the steps below are the manual recovery.

**Steps**

```bash
docker compose exec db psql -U stellarcade -d stellarcade \
  -c "SELECT name, cursor, updated_at FROM worker_cursors;"
```

1. If the cursor is stale (or `updated_at` is old), delete it and start from
   a recent ledger:

```bash
docker compose exec db psql -U stellarcade -d stellarcade \
  -c "DELETE FROM worker_cursors WHERE name = 'indexer';"
```

2. Set `INDEXER_START_LEDGER` to the current ledger minus a small margin
   (the value is printed by `/health/deep` → `soroban.latencyMs` context, or
   `stellar ledger --network testnet`) and restart the backend.
3. Rounds whose `bet_placed` happened before the new start ledger are
   backfilled: when their `bet_resolved` event arrives and no row exists,
   the worker simulates `get_game` and inserts the row. Rounds still pending
   at that point appear as soon as they resolve — they are not lost.
4. The same recovery applies to the oracle worker with
   `worker_cursors.name = 'oracle'` and `ORACLE_START_LEDGER`.

**Resolved when:** the `worker_cursors.updated_at` timestamp advances every
poll, and the previously missing round is present:

```bash
curl -sS "$API/games/recent?pageSize=20" | jq '.items[] | {chain_game_id, status, result}'
```

---

## 6. RPC provider outage

**Symptoms:** `/health/deep` reports `soroban.status = "unhealthy"`; both
workers log `getEvents` / simulation failures; `/verify` and the play panel
cannot read contracts.

**Steps**

1. Confirm it is the provider, not the contracts:
   `curl -sS https://soroban-testnet.stellar.org -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
2. Switch the backend to a standby endpoint — set `SOROBAN_RPC_URL` in the
   platform secret store (it is read in `backend/src/config/stellar.js`) and
   restart. Testnet default: `https://soroban-testnet.stellar.org`.
3. If the public web app also fails to read contracts, update
   `NEXT_PUBLIC_SOROBAN_RPC_URL` (and redeploy the frontend).

**Resolved when:** `/health/deep` → `soroban.status = "healthy"`, worker logs
resume advancing `worker_cursors.updated_at`, and `get_commitment_queue_len`
answers.

---

## Function signatures used

From `contracts/coin-flip/src/lib.rs` (line numbers on `main`):

| Function | Signature |
| --- | --- |
| `set_paused` | `pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error>` (`lib.rs:761`) |
| `is_paused` | `pub fn is_paused(env: Env) -> Result<bool, Error>` (`lib.rs:809`) |
| `fund_house` | `pub fn fund_house(env: Env, admin: Address, amount: i128) -> Result<(), Error>` (`lib.rs:684`) |
| `withdraw_house` | `pub fn withdraw_house(env: Env, admin: Address, amount: i128) -> Result<(), Error>` (`lib.rs:700`) |
| `house_balance` | `pub fn house_balance(env: Env) -> Result<i128, Error>` (`lib.rs:728`) |
| `house_exposure_snapshot` | `pub fn house_exposure_snapshot(env: Env) -> Result<HouseExposureSnapshot, Error>` (`lib.rs:643`) |
| `set_wager_limits` | `pub fn set_wager_limits(env: Env, admin: Address, min_wager: i128, max_wager: i128) -> Result<(), Error>` (`lib.rs:735`) |
| `cancel_stale_bet` | `pub fn cancel_stale_bet(env: Env, player: Address, game_id: u64) -> Result<(), Error>` (`lib.rs:519`) |
| `resolve_bet` | `pub fn resolve_bet(env: Env, game_id: u64) -> Result<(), Error>` (`lib.rs:419`) |
| `get_game` | `pub fn get_game(env: Env, game_id: u64) -> Result<Game, Error>` (`lib.rs:590`) |
| `place_bet` | `pub fn place_bet(env: Env, player: Address, side: u32, wager: i128, game_id: u64) -> Result<(), Error>` (`lib.rs:305`) |

From `contracts/random-generator/src/lib.rs`:

| Function | Signature |
| --- | --- |
| `init` | `pub fn init(env: Env, admin: Address, oracle: Address) -> Result<(), Error>` (`lib.rs:253`) — one-time; **no setter for `oracle` exists** |
| `authorize` / `revoke` | `pub fn authorize(env: Env, admin: Address, caller: Address) -> Result<(), Error>` (`lib.rs:271` / `lib.rs:287`) |
| `commit_seeds` | `pub fn commit_seeds(env: Env, oracle: Address, commitments: Vec<BytesN<32>>) -> Result<u32, Error>` (`lib.rs:304`) |
| `fulfill_random` | `pub fn fulfill_random(env: Env, oracle: Address, request_id: u64, server_seed: BytesN<32>) -> Result<(), Error>` (`lib.rs:471`) |
| `get_commitment_queue_len` | `pub fn get_commitment_queue_len(env: Env) -> u32` (`lib.rs:341`) |
| `get_result` | `pub fn get_result(env: Env, request_id: u64) -> Result<FulfilledEntry, Error>` (`lib.rs:625`) |
| `get_config` | `pub fn get_config(env: Env) -> Result<GeneratorConfig, Error>` (`lib.rs:689`) |

Backend API used here: `GET /api/health`, `GET /api/health/deep`
(`backend/src/routes/health.routes.js`), `GET /api/games/recent`
(`backend/src/routes/games.routes.js`).

---

## Dry-run log (testnet)

Executed against a stack built from this tree
(`cargo build -p stellarcade-random-generator -p stellarcade-coin-flip --target
wasm32v1-none --release --locked`), stellar CLI 25.1.0, network `testnet`,
admin `GBQDK5VERHW2SHGD4FQKG7C5JMZ77NYPL5IXEIDJC3EWKPC5NGCEBQRO`:

- `$RNG_ID` = `CDET7LAKBJ452RPSNC2NP7RUFRGS4BGXXGBWYGVGBFANN3H7NF7V5VFZ`
- `$COIN_FLIP_ID` = `CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ`

**Pause** (`set_paused --paused true`):

```text
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- is_paused
false
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- set_paused --admin "$ADMIN" --paused true
ℹ️  Signing transaction: a45dd1b0caf3e61eb102473be09cdeac17e9166bbf7c100fbe1627d268038a7d
📅 CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ - Success - Event: [{"symbol":"contract_paused"},{"address":"GBQDK5VERHW2SHGD4FQKG7C5JMZ77NYPL5IXEIDJC3EWKPC5NGCEBQRO"}] = {"map":[{"key":{"symbol":"paused"},"val":{"bool":true}}]}
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- is_paused
true
```

**Unpause** (`set_paused --paused false`):

```text
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- set_paused --admin "$ADMIN" --paused false
ℹ️  Signing transaction: 23770a59ca08953c4c73dca277dc7582da4ab589e7af194a632b4c342a9cc5fe
📅 CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ - Success - Event: [{"symbol":"contract_paused"},{"address":"GBQDK5VERHW2SHGD4FQKG7C5JMZ77NYPL5IXEIDJC3EWKPC5NGCEBQRO"}] = {"map":[{"key":{"symbol":"paused"},"val":{"bool":false}}]}
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- is_paused
false
```

**fund_house** (100 XLM at init, then a 10 XLM top-up):

```text
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- fund_house --admin "$ADMIN" --amount 100000000
ℹ️  Signing transaction: d759597b60ef83dddc0332bffec18b9407fc4fc3127ea639ad9ee22576dca4e3
📅 CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC - Success - Event: [{"symbol":"transfer"},{"address":"GBQDK5VERHW2SHGD4FQKG7C5JMZ77NYPL5IXEIDJC3EWKPC5NGCEBQRO"},{"address":"CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ"},{"string":"native"}] = {"i128":"100000000"}
📅 CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ - Success - Event: [{"symbol":"house_funded"},{"address":"GBQDK5VERHW2SHGD4FQKG7C5JMZ77NYPL5IXEIDJC3EWKPC5NGCEBQRO"}] = {"map":[{"key":{"symbol":"amount"},"val":{"i128":"100000000"}}]}
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- house_balance
"1100000000"
$ stellar contract invoke --id "$COIN_FLIP_ID" --source admin --network testnet -- house_exposure_snapshot
{"active_game_count":0,"max_payout_liability":"0","total_wagered":"0"}
```

**A non-admin cannot pause** (sanity check of `require_admin`):

```text
$ stellar contract invoke --id "$COIN_FLIP_ID" --source alice --network testnet -- set_paused --admin "$(stellar keys address alice)" --paused true
   0: [Diagnostic Event] contract:CAA7MSM77YCU73NSBR46CIS26LSJT6RTBT476BEZ67BL5GUIFIQXLVBQ, topics:[error, Error(Contract, #3)], data:...
$ stellar contract invoke --id "$COIN_FLIP_ID" --source alice --network testnet -- is_paused
false
```

`Error(Contract, #3)` is `NotAuthorized`; the contract stayed unpaused.
