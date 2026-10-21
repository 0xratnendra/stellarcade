# 🌌 Stellarcade

[![Lint Codebase](https://github.com/theblockcade/stellarcade/actions/workflows/lint.yml/badge.svg)](https://github.com/theblockcade/stellarcade/actions/workflows/lint.yml)
[![Test Backend API](https://github.com/theblockcade/stellarcade/actions/workflows/test-backend.yml/badge.svg)](https://github.com/theblockcade/stellarcade/actions/workflows/test-backend.yml)
[![Test Contracts](https://github.com/theblockcade/stellarcade/actions/workflows/test-contracts.yml/badge.svg)](https://github.com/theblockcade/stellarcade/actions/workflows/test-contracts.yml)
[![Test Frontend App](https://github.com/theblockcade/stellarcade/actions/workflows/test-web.yml/badge.svg)](https://github.com/theblockcade/stellarcade/actions/workflows/test-web.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Stellarcade** is a decentralized arcade platform built on the Stellar network using Soroban smart contracts. We provide provably fair games, community prize pools, and a seamless gaming experience using Stellar's fast and low-cost infrastructure.

## ✨ Key Features

- **Provably Fair Gaming**: Our Random Number Generator (RNG) contract ensures every game result is verifiable and fair.
- **Decentralized Prize Pools**: Play and win from pools managed entirely by smart contracts.
- **Stellar Speed**: Lightning-fast transactions and minimal fees.
- **Multiple Games**: Coin Flip, Trivia, and more—all on-chain.
- **Open Source**: Built by the community, for the community.

## 🌐 Live Environment & Deployed Services (Stellar Testnet)

| Service / Contract             | Type / Hosting     | Live Endpoint / Address                                    |
| ------------------------------ | ------------------ | ---------------------------------------------------------- |
| **Backend API**                | Render Web Service | `https://stellarcade-backend.onrender.com/api`             |
| **Arbiter Engine**             | Render Web Service | `https://stellarcade-arbiter.onrender.com`                 |
| **Telegram Bot**               | Render Web Service | Active via `@StellarcadeOfficialBot`                       |
| **Coin Flip Contract**         | Soroban Testnet    | `CDP77TELLHACC46EHR3N4ISRWJME446AGK5RM7D4D42YKDCB4LXICKTE` |
| **Prize Pool Contract**        | Soroban Testnet    | `CBVNIITX42KQA3MKNUBKG4YIK4FCASZQWKWGHY3YYMM4ANGZ6MOZI2EC` |
| **Random Generator Contract**  | Soroban Testnet    | `CAMYBISVQSSVJ3EPAZQWKPTTPGTYY5XIS2BZAG4TYFWTUKHQNPVXAV4O` |
| **Access Control Contract**    | Soroban Testnet    | `CC2IRAYC3CT5KAV4PZKXKCE45Z3QAJQSJH7P5J3GITJT4T3KZ6634R7K` |
| **Achievement Badge Contract** | Soroban Testnet    | `CC7SDE6RRV4X7XRHU6OM6GLDIKBC6EZYNHTRGDLEHYNVUWWO3LUJLA5M` |

## 🛠 Tech Stack

- **Smart Contracts**: Rust & Soroban SDK
- **Backend**: Node.js, Express, PostgreSQL, Redis
- **Frontend**: Vite + React (TypeScript)
- **Infrastructure**: Docker, GitHub Actions

## 📦 TypeScript SDK

StellarCade ships with an official, open-source TypeScript SDK for wallet connection, game interactions, and client-side fairness verification:

```bash
npm install @stellarcade/sdk @stellar/stellar-sdk
```

For setup and client configuration details, see the [stellarcade-sdk repository](https://github.com/TheBlockCade/stellarcade-sdk).

## 🚀 Quick Start

> **New Contributor?** Follow our step-by-step [**End-to-End Testnet Quickstart**](docs/QUICKSTART.md) to run the full stack locally, deploy/wire contracts, and play a real round on testnet.

### Prerequisites

- [Rust & Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- [Node.js (v18+)](https://nodejs.org/)
- [Docker](https://www.docker.com/)

### Local Development Setup

For a complete local development environment:

```bash
# Clone the repository
git clone https://github.com/theblockcade/stellarcade.git
cd stellarcade

# Enable Git hooks (mirrors CI checks locally)
git config core.hooksPath .githooks

# Start all services (PostgreSQL, Redis, Backend)
docker-compose up -d

# Build contracts
cd contracts && soroban contract build && cd ..

# Set up backend
cd backend && npm install && npm run migrate && cd ..

# Set up frontend
cd frontend && pnpm install && cd ..
```

See the complete [Setup Guide](docs/SETUP.md) for detailed instructions, verification steps, and troubleshooting.

## 📁 Project Structure

```
stellarcade/
├── contracts/          # Soroban smart contracts (Rust)
│   ├── prize-pool/    # Prize pool management
│   ├── coin-flip/     # Coin flip game
│   ├── random-generator/  # Provably fair RNG
│   └── ...
├── backend/           # Node.js API server
│   ├── src/          # Source code
│   ├── migrations/   # Database migrations
│   └── tests/        # API tests
├── frontend/          # React + Vite frontend
│   ├── src/          # React components
│   └── tests/        # Frontend tests
├── docs/             # Documentation
└── scripts/          # Utility scripts
```

## 📚 Documentation

| Document                                   | Description                      |
| ------------------------------------------ | -------------------------------- |
| [Setup Guide](docs/SETUP.md)               | Complete local development setup |
| [Architecture](docs/ARCHITECTURE.md)       | System design and components     |
| [API Reference](docs/API_DOCUMENTATION.md) | REST API documentation           |
| [Game Rules](docs/GAME_RULES.md)           | Game mechanics and rules         |
| [Deployment](docs/DEPLOYMENT.md)           | Production deployment guide      |
| [Incident Runbook](docs/runbook.md)        | Oracle / indexer / RPC incidents |
| [Contributing](CONTRIBUTING.md)            | How to contribute                |

### Subsystem Documentation

- [Backend](backend/README.md) - API server setup and development
- [Frontend](frontend/README.md) - Frontend development guide
- [Contracts](contracts/README.md) - Smart contract development

## 🧪 Testing

```bash
# Run contract tests
cd contracts && cargo test

# Run backend tests
cd backend && npm test

# Run frontend tests
cd frontend && pnpm test
```

## 🐳 Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Enable Git hooks (`git config core.hooksPath .githooks`)
4. Make your changes and run tests
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 🛡 Security

For security concerns or to report vulnerabilities, please see our [SECURITY.md](SECURITY.md).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💬 Community

- [Discord Placeholder](#)
- [Twitter / X Placeholder](#)
- [Stellar Developers Foundation](https://stellar.org/developers)

## 🙏 Acknowledgments

- Built on [Stellar](https://stellar.org) and [Soroban](https://soroban.stellar.org)
- Inspired by the decentralized gaming movement
- Created with ❤️ by the community

---

_Created with ❤️ for the Stellar Ecosystem (2026)_
