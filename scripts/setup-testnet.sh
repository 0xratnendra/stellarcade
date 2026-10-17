#!/usr/bin/env bash

# setup-testnet.sh
# Creates and funds admin, oracle, and player1 identities on Stellar Testnet using the stellar CLI.

set -euo pipefail

NETWORK="testnet"
IDENTITIES=("admin" "oracle" "player1")

echo "=== Setting up Stellar Testnet Identities ==="

# Check that the stellar CLI is installed
if ! command -v stellar &> /dev/null; then
  echo "[!] Error: 'stellar' CLI is not installed or not in PATH."
  echo "    Install with: cargo install --locked stellar-cli"
  exit 1
fi

for id in "${IDENTITIES[@]}"; do
  echo "Checking identity '$id'..."
  if stellar keys ls | grep -qw "$id"; then
    addr=$(stellar keys address "$id")
    echo "  [✓] Identity '$id' already exists ($addr). Skipping generation."
  else
    echo "  [+] Generating and funding identity '$id' on $NETWORK..."
    stellar keys generate "$id" --fund --network "$NETWORK"
    addr=$(stellar keys address "$id")
    echo "  [✓] Identity '$id' created with address: $addr"
  fi
done

echo "============================================="
echo "Testnet identities configured and funded successfully."
