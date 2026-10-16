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
