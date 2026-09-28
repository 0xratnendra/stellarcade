# Healthcheck Dashboard CLI

A small terminal dashboard for monitoring Stellar RPC nodes and backend services.

## Features
- Polls Soroban, Horizon, and backend health endpoints
- Displays operational/degraded/down signals
- Shows latency sparkline charts
- Tracks ledger sequence and sync lag
- Includes keyboard controls:
  - `r` = refresh now
  - `q` = quit

## Usage
```bash
node --import tsx cli.ts --config endpoints.json --interval 5s
```

## Example config
```json
[
  {
    "id": "soroban-testnet",
    "name": "Soroban Testnet",
    "url": "https://soroban-testnet.stellar.org",
    "type": "soroban"
  },
  {
    "id": "horizon",
    "name": "Horizon",
    "url": "https://horizon-testnet.stellar.org",
    "type": "horizon"
  },
  {
    "id": "backend-api",
    "name": "Backend API",
    "url": "https://api.example.com/health",
    "type": "backend"
  }
]
```
