# Testnet Deployment Scripts

This directory provides scripts to configure testnet identities, deploy, initialize, and wire up the smart contracts on Stellar Testnet.

## Prerequisites

1. Install the `stellar` CLI:
   ```bash
   cargo install --locked stellar-cli
   ```
2. Ensure `wasm32v1-none` target is installed:
   ```bash
   rustup target add wasm32v1-none
   ```

## Workflow

### 1. Configure and Fund Testnet Identities
Run `setup-testnet.sh` to generate and fund `admin`, `oracle`, and `player1` keys on testnet:
```bash
./scripts/setup-testnet.sh
```

### 2. Validate Deployment Environment (Dry-run)
Check prerequisites, identities, and built WASM artifacts:
```bash
./scripts/deploy-contracts.sh --dry-run
```

### 3. Deploy, Initialize, and Wire Contracts
Build WASM and deploy the full stack to testnet:
```bash
./scripts/deploy-contracts.sh --network testnet --source admin --build
```

This single command:
- Builds `random-generator` and `coin-flip` to `contracts/target/wasm32v1-none/release/`.
- Deploys both contracts to Stellar Testnet.
- Initializes `random-generator` with `admin` and `oracle`.
- Authorizes `coin-flip` as an authorized caller on `random-generator`.
- Initializes `coin-flip` with `admin`, `random-generator`, native XLM SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`), wager limits, and 250 bps house edge.
- Funds the house bankroll via `fund_house`.
- Commits initial seed commitments via `commit_seeds`.
- Outputs contract addresses and network config to `deployments/testnet.json`.

### 4. Re-running Deployments
Re-running without `--fresh` will reuse the existing `deployments/testnet.json` without making redundant deployments:
```bash
./scripts/deploy-contracts.sh
```
To force a fresh deployment:
```bash
./scripts/deploy-contracts.sh --fresh --build
```

## Testnet smoke test (coin flip)

`scripts/smoke/coin-flip-round.mjs` plays one real coin-flip round against the
deployment in `deployments/testnet.json` and checks every step:

1. the manifest loads and both contracts exist on the network;
2. coin-flip's `MinWager` / `HouseEdgeBps` are read from instance storage;
3. a fresh throwaway player is created and funded with Friendbot, and its XLM
   balance recorded;
4. `place_bet` is submitted with a random `game_id` and the minimum wager;
5. `get_game(game_id).resolved` becomes true within `--timeout` seconds — the
   **deployed oracle worker** must fulfil the randomness and resolve the game;
6. the payout matches `won ? 2·wager − wager·edge/10000 : 0`;
7. the player's balance changed by exactly `payout − wager − fee`;
8. `sha256(server_seed) == commitment` from `get_result`, the recomputed
   `sha256(server_seed || game_id_be)[0..8] % max` equals the stored result,
   and the settled win/loss follows from it;
9. the game id appears in `GET <api-url>/games/recent`.

Each step prints `PASS`/`FAIL`; the script exits non-zero on the first failure.
It uses no secrets — the only key is the player keypair it generates.

```bash
pnpm install --frozen-lockfile          # provides @stellar/stellar-sdk (via apps/web)
node scripts/smoke/coin-flip-round.mjs \
  [--deployment deployments/testnet.json] \
  [--api-url https://stellarcade-backend.onrender.com/api] \
  [--timeout 180]
```

CI runs it from `.github/workflows/testnet-smoke.yml` nightly and on
`workflow_dispatch` (not on pull requests). A failed step fails the job.


The deployment script now builds, deploys, authorizes, initializes, and funds dice-roll alongside coin-flip, and writes contracts.diceRoll plus the dice-roll environment variable names to the deployment output.


The deployment script now builds, deploys, authorizes, initializes, and funds dice-roll alongside coin-flip, and writes contracts.diceRoll plus the dice-roll environment variable names to the deployment output.
