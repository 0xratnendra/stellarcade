#!/usr/bin/env bash

# deploy-contracts.sh
# Builds, deploys, initializes, and wires up the coin-flip and random-generator contracts on testnet.

set -euo pipefail

NETWORK="testnet"
SOURCE="admin"
BUILD=false
FRESH=false
DRY_RUN=false
MIN_WAGER="10000000"      # 1 XLM (stroops, 10^7)
MAX_WAGER="1000000000"    # 100 XLM
BANKROLL="10000000000"
DICE_BANKROLL="10000000000"    # 1,000 XLM
HOUSE_EDGE_BPS="250"      # 2.5%

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOYMENTS_FILE="$REPO_ROOT/deployments/testnet.json"

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --network <name>       Network to deploy to (default: testnet)
  --source <name>        Identity/key to use for signing (default: admin)
  --build                Build WASM contracts before deploying
  --fresh                Deploy new contract instances even if deployments/testnet.json exists
  --dry-run              Validate tools, identities, and artifacts without deploying
  --min-wager <amount>   Minimum allowed wager in stroops (default: 10000000)
  --max-wager <amount>   Maximum allowed wager in stroops (default: 1000000000)
  --bankroll <amount>    Initial bankroll funding in stroops (default: 10000000000)
  --dice-bankroll <amount> Initial dice-roll bankroll in stroops (default: 10000000000)
  --dice-bankroll <amount> Initial dice-roll bankroll in stroops (default: 10000000000)
  --help                 Show this help message
EOF
  exit 1
}

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --network) NETWORK="$2"; shift ;;
    --source) SOURCE="$2"; shift ;;
    --build) BUILD=true ;;
    --fresh) FRESH=true ;;
    --dry-run) DRY_RUN=true ;;
    --min-wager) MIN_WAGER="$2"; shift ;;
    --max-wager) MAX_WAGER="$2"; shift ;;
    --bankroll) BANKROLL="$2"; shift ;;
    --dice-bankroll) DICE_BANKROLL="$2"; shift ;;
    --help) usage ;;
    *) echo "Unknown parameter: $1"; usage ;;
  esac
  shift
done

# Check existing deployment unless --fresh is passed
if [ "$FRESH" = false ] && [ "$DRY_RUN" = false ] && [ -f "$DEPLOYMENTS_FILE" ]; then
  echo "Found existing deployment at $DEPLOYMENTS_FILE. Reusing existing deployment (use --fresh to override):"
  cat "$DEPLOYMENTS_FILE"
  exit 0
fi

if [ "$DRY_RUN" = true ]; then
  echo "=== DEPLOYMENT DRY-RUN VALIDATION ==="
  VALIDATION_ERROR=0

  # 1. Check stellar CLI
  if ! command -v stellar &> /dev/null; then
    echo "[!] Error: 'stellar' CLI is not installed."
    VALIDATION_ERROR=1
  else
    echo "[✓] stellar CLI is installed."
  fi

  # 2. Check Identity
  if command -v stellar &> /dev/null; then
    if ! stellar keys ls | grep -qw "$SOURCE"; then
      echo "[!] Error: Identity '$SOURCE' not found in stellar keys."
      VALIDATION_ERROR=1
    else
      echo "[✓] Identity '$SOURCE' is configured ($(stellar keys address "$SOURCE"))."
    fi
  fi

  # 3. Check WASM artifacts
  echo "Checking WASM artifacts..."
  for crate in "random-generator" "coin-flip" "dice-roll"; do
    wasm="$REPO_ROOT/contracts/target/wasm32v1-none/release/stellarcade_${crate//-/_}.wasm"
    if [ ! -f "$wasm" ]; then
      echo "  [!] Missing: $wasm (Run with --build?)"
      VALIDATION_ERROR=1
    else
      echo "  [✓] Found: $wasm"
    fi
  done

  if [ $VALIDATION_ERROR -eq 1 ]; then
    echo "-------------------------------------"
    echo "Dry-run validation FAILED."
    exit 1
  else
    echo "-------------------------------------"
    echo "Dry-run validation SUCCESSFUL. Environment is ready for deployment."
    exit 0
  fi
fi

# Build contracts if requested
if [ "$BUILD" = true ]; then
  echo "Building contracts for target wasm32v1-none in release mode..."
  cd "$REPO_ROOT/contracts"
  cargo build -p stellarcade-random-generator --target wasm32v1-none --release --locked
  cargo build -p stellarcade-coin-flip --target wasm32v1-none --release --locked
  cargo build -p stellarcade-dice-roll --target wasm32v1-none --release --locked
  cd "$REPO_ROOT"
fi

RNG_WASM="$REPO_ROOT/contracts/target/wasm32v1-none/release/stellarcade_random_generator.wasm"
COIN_FLIP_WASM="$REPO_ROOT/contracts/target/wasm32v1-none/release/stellarcade_coin_flip.wasm"
DICE_ROLL_WASM="$REPO_ROOT/contracts/target/wasm32v1-none/release/stellarcade_dice_roll.wasm"

if [ ! -f "$RNG_WASM" ] || [ ! -f "$COIN_FLIP_WASM" ] || [ ! -f "$DICE_ROLL_WASM" ]; then
  echo "[!] Error: WASM artifacts not found. Please run with --build."
  exit 1
fi

ADMIN_ADDR=$(stellar keys address "$SOURCE")
ORACLE_ADDR=$(stellar keys address oracle 2>/dev/null || echo "$ADMIN_ADDR")

echo "Deploying contracts to $NETWORK using admin: $ADMIN_ADDR..."

# 1. Deploy random-generator
echo "Deploying random-generator..."
RNG_ID=$(stellar contract deploy \
  --wasm "$RNG_WASM" \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "  [✓] random-generator deployed at: $RNG_ID"

# Initialize random-generator
echo "Initializing random-generator..."
stellar contract invoke \
  --id "$RNG_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN_ADDR" \
  --oracle "$ORACLE_ADDR"

# 2. Deploy coin-flip
echo "Deploying coin-flip..."
COIN_FLIP_ID=$(stellar contract deploy \
  --wasm "$COIN_FLIP_WASM" \
  --source "$SOURCE" \
  --network "$NETWORK")
echo "  [✓] coin-flip deployed at: $COIN_FLIP_ID"


# 3. Deploy dice-roll using the same RNG, token, and wager configuration.
echo "Deploying dice-roll..."
DICE_ROLL_ID=$(stellar contract deploy --wasm "$DICE_ROLL_WASM" --source "$SOURCE" --network "$NETWORK")
echo "  [âœ“] dice-roll deployed at: $DICE_ROLL_ID"
stellar contract invoke --id "$RNG_ID" --source "$SOURCE" --network "$NETWORK" -- authorize --admin "$ADMIN_ADDR" --caller "$DICE_ROLL_ID"
stellar contract invoke --id "$DICE_ROLL_ID" --source "$SOURCE" --network "$NETWORK" -- init --admin "$ADMIN_ADDR" --rng_contract "$RNG_ID" --token "$NATIVE_SAC" --min_wager "$MIN_WAGER" --max_wager "$MAX_WAGER" --house_edge_bps "$HOUSE_EDGE_BPS"
echo "Funding dice-roll bankroll ($DICE_BANKROLL stroops)..."
stellar contract invoke --id "$DICE_ROLL_ID" --source "$SOURCE" --network "$NETWORK" -- fund_house --admin "$ADMIN_ADDR" --amount "$DICE_BANKROLL"
# Native XLM SAC on testnet
NATIVE_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

# Authorize coin-flip on random-generator
echo "Authorizing coin-flip as caller on random-generator..."
stellar contract invoke \
  --id "$RNG_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- authorize \
  --admin "$ADMIN_ADDR" \
  --caller "$COIN_FLIP_ID"

# Initialize coin-flip
echo "Initializing coin-flip..."
stellar contract invoke \
  --id "$COIN_FLIP_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- init \
  --admin "$ADMIN_ADDR" \
  --rng_contract "$RNG_ID" \
  --token "$NATIVE_SAC" \
  --min_wager "$MIN_WAGER" \
  --max_wager "$MAX_WAGER" \
  --house_edge_bps "$HOUSE_EDGE_BPS"

# Fund house bankroll
echo "Funding coin-flip bankroll ($BANKROLL stroops)..."
stellar contract invoke \
  --id "$COIN_FLIP_ID" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- fund_house \
  --admin "$ADMIN_ADDR" \
  --amount "$BANKROLL"

# Commit initial seeds
echo "Committing initial seed batch on random-generator..."
# Pre-commit 3 sample seed hashes
SEED_HASH_1="0000000000000000000000000000000000000000000000000000000000000001"
SEED_HASH_2="0000000000000000000000000000000000000000000000000000000000000002"
SEED_HASH_3="0000000000000000000000000000000000000000000000000000000000000003"

stellar contract invoke \
  --id "$RNG_ID" \
  --source "oracle" 2>/dev/null || stellar contract invoke --id "$RNG_ID" --source "$SOURCE" \
  --network "$NETWORK" \
  -- commit_seeds \
  --oracle "$ORACLE_ADDR" \
  --commitments "[\"$SEED_HASH_1\", \"$SEED_HASH_2\", \"$SEED_HASH_3\"]"

mkdir -p "$(dirname "$DEPLOYMENTS_FILE")"

DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat <<EOF > "$DEPLOYMENTS_FILE"
{
  "network": "$NETWORK",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "contracts": {
    "coinFlip": "$COIN_FLIP_ID",
    "randomGenerator": "$RNG_ID",
    "diceRoll": "$DICE_ROLL_ID"
    "diceRoll": "$DICE_ROLL_ID"
  },
  "nativeToken": "$NATIVE_SAC",
  "deployedAt": "$DEPLOYED_AT"
}
EOF

echo "============================================="
echo "Deployment successful! Written to $DEPLOYMENTS_FILE"
echo ""
echo "=== Environment Variables for Apps ==="
echo "apps/web/.env.local:"
echo "NEXT_PUBLIC_STELLAR_NETWORK=$NETWORK"
echo "NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org"
echo "NEXT_PUBLIC_COIN_FLIP_CONTRACT_ID=$COIN_FLIP_ID"
echo "NEXT_PUBLIC_DICE_ROLL_CONTRACT_ID=$DICE_ROLL_ID"
echo "NEXT_PUBLIC_RANDOM_GENERATOR_CONTRACT_ID=$RNG_ID"
echo "NEXT_PUBLIC_NATIVE_SAC_ID=$NATIVE_SAC"
echo ""
echo "backend/.env:"
echo "STELLAR_NETWORK=$NETWORK"
echo "SOROBAN_RPC_URL=https://soroban-testnet.stellar.org"
echo "COIN_FLIP_CONTRACT_ID=$COIN_FLIP_ID"
echo "DICE_ROLL_CONTRACT_ID=$DICE_ROLL_ID"
echo "RANDOM_GENERATOR_CONTRACT_ID=$RNG_ID"
echo "============================================="
