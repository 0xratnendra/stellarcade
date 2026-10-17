# Quickstart: Running StellarCade Locally Against Testnet

This guide walks you from a clean clone to playing a live, provably fair Coin-Flip round on Stellar Testnet and verifying its cryptographic proof on `/verify`.

---

## 1. Prerequisites

Ensure your development environment has the required toolchains installed:

| Tool                 | Version / Target        | Check Command                                          |
| -------------------- | ----------------------- | ------------------------------------------------------ |
| **Rust**             | Stable (1.80+)          | `rustc --version`                                      |
| **Wasm Target**      | `wasm32v1-none`         | `rustup target list --installed \| grep wasm32v1-none` |
| **Stellar CLI**      | Latest                  | `stellar --version`                                    |
| **Node.js**          | Node 20 or 22           | `node --version`                                       |
| **pnpm**             | v9 or v10               | `pnpm --version`                                       |
| **Docker**           | Docker Engine & Compose | `docker compose version`                               |
| **Freighter Wallet** | Browser Extension       | Set Network to **Testnet**                             |

Install the Wasm target and Stellar CLI if missing:

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli
```

---

## 2. Infrastructure & Database Migrations

StellarCade requires PostgreSQL and Redis for session state, indexer data, and idempotency caching.

1. Start Postgres and Redis in the background:

   ```bash
   docker-compose up -d
   ```

   _Expected output:_

   ```text
   [+] Running 2/2
   ✔ Container stellarcade-redis     Started
   ✔ Container stellarcade-postgres  Started
   ```

2. Run database migrations inside `backend/`:
   ```bash
   cd backend
   npm install
   npm run migrate
   ```
   _Expected output:_
   ```text
   Batch 1 ran the following migrations:
   20260324_create_users_table.js
   20260324_create_games_table.js
   20260325_create_worker_cursors.js
   20260325_create_quests_and_tournaments.js
   ```

---

## 3. Contracts Configuration (Testnet)

You have two choices: use the committed deployment manifest or deploy your own fresh contracts to testnet.

### Option A: Use the Pre-deployed Testnet Manifest (Recommended)

StellarCade commits active, funded testnet contracts in `deployments/testnet.json`:

- **Coin-Flip:** `CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5`
- **Random-Generator (RNG):** `CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5`

### Option B: Deploy Your Own Contracts to Testnet

If you want your own isolated contract instances:

```bash
# 1. Generate and fund admin, oracle, and player keys on testnet:
./scripts/setup-testnet.sh

# 2. Build and deploy contracts to testnet:
./scripts/deploy-contracts.sh --network testnet --source admin --build
```

This deploys both contracts, initializes the house bankroll, commits initial entropy seeds, and writes contract IDs to `deployments/testnet.json`.

---

## 4. Environment Variables Setup

### Backend Configuration (`backend/.env`)

Copy the example file:

```bash
cp backend/.env.example backend/.env
```

Ensure the following contract and worker settings are present:

```dotenv
PORT=3000
NODE_ENV=development

DATABASE_URL=postgres://postgres:postgres@localhost:5432/stellarcade
REDIS_URL=redis://localhost:6379

STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

COIN_FLIP_CONTRACT_ID=CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5
RANDOM_GENERATOR_CONTRACT_ID=CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5

# Workers: Enable oracle (to fulfill randomness) and indexer (to record game history)
ORACLE_ENABLED=true
INDEXER_ENABLED=true
ORACLE_MIN_QUEUE=20
JWT_SECRET=dev_jwt_secret_change_in_production
```

### Frontend Configuration (`apps/web/.env.local`)

Create `apps/web/.env.local`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Ensure the contract IDs and local API endpoint are set:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID=CD2JPFUCKNDMA3OVYVQOAELTMR5VQPMAA6J6GJYQE2SQFNGKCBSSOKG5
NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID=CD3VAX3DZEGWEMMPK35MYPS43HMFTNHZK5SY22JLEHHENXJATWP4HJY5
```

---

## 5. Starting the Stack

1. **Start the Backend API + Workers** (in terminal 1):

   ```bash
   cd backend
   npm run dev
   ```

   _Expected output:_

   ```text
   [INFO] Stellar SDK initialized for testnet at https://horizon-testnet.stellar.org
   [INFO] Oracle worker started. Polling every 5000ms.
   [INFO] Indexer worker started. Polling every 5000ms.
   [INFO] Server running on port 3000
   ```

2. **Start the Frontend Web Application** (in terminal 2):
   ```bash
   pnpm --filter @stellarcade/web dev
   ```
   _Expected output:_
   ```text
   ▲ Next.js 16.2
   - Local:        http://localhost:3001
   - Environments: .env.local
   ✓ Ready in 1200ms
   ```

---

## 6. Playing a Coin-Flip Round and Verifying

1. **Connect Wallet:**
   - Open `http://localhost:3001` in your browser.
   - Open the Freighter extension and switch the network toggle to **Testnet**.
   - Fund your testnet wallet using [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
   - Click **Connect Wallet** on StellarCade.

2. **Play a Coin-Flip Round:**
   - Navigate to `/games` and select **Coinflip Duel**.
   - Choose **Heads** or **Tails** and select a wager (e.g. 5 XLM).
   - Click **Flip Coin** and approve the transaction in Freighter.
   - Watch the oracle resolve the randomness on-chain in real time.

3. **Verify Fairness on `/verify`:**
   - Once the round settles, click **Verify Fairness** or navigate to `/verify`.
   - Enter your `gameId` or paste the commit-reveal parameters (`serverSeed`, `clientSeed`, `nonce`).
   - Confirm that the SHA-256 hash matches the committed hash on-chain.

---

## 7. Troubleshooting

Here are solutions for the three most common setup hurdles:

### 1. `ORACLE_ENABLED=false` or Round Remains Unresolved

- **Symptom:** `place_bet` succeeds on-chain, but the game spinner hangs and never shows won/lost.
- **Cause:** The backend oracle worker resolves random seed commitments. If `ORACLE_ENABLED` is false, no worker is polling for `RandomRequested` events.
- **Fix:** Set `ORACLE_ENABLED=true` in `backend/.env` and ensure `ORACLE_SECRET_KEY` matches an authorized oracle keypair.

### 2. Freighter "Wrong Network" or Signature Rejected

- **Symptom:** Bet transaction fails simulation or Freighter shows a network mismatch alert.
- **Cause:** Freighter is set to Public/Mainnet or Futurenet instead of Stellar Testnet.
- **Fix:** In Freighter settings, ensure **Testnet** is selected and matches the passphrase `"Test SDF Network ; September 2015"`.

### 3. Contract Simulation Error `Error(Contract, #1)` (House Insolvency)

- **Symptom:** Bet submission fails with an invocation error code 1.
- **Cause:** The Coin-Flip contract's house bankroll does not have enough XLM reserves to cover the potential maximum payout of your wager.
- **Fix:** Deposit funds into the house bankroll by invoking `fund_house` via the `stellar` CLI or deploy script:
  ```bash
  stellar contract invoke \
    --id <COIN_FLIP_CONTRACT_ID> \
    --source-account admin \
    --network testnet \
    -- fund_house --amount 10000000000
  ```
