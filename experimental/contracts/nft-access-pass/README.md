# NFT Access Pass Gatekeeper

Experimental Soroban contract verifying Stellar NFT badge ownership and issuing
short-lived, single-use game access tickets for restricted VIP tournaments.

## Flow

1. `initialize` — admin registers the authorized NFT collection contract.
2. `verify_and_issue_pass` — player (auth required) must hold ≥ 1 collection
   token; a unique SHA256 ticket valid for `PASS_TTL_LEDGERS` is issued.
3. `validate_pass` — entry check; false for unknown/wrong-owner/used/expired
   tickets and for wallets whose NFT was transferred away (revocation).
4. `consume_pass` — burns a ticket's single use on tournament entry.
5. `get_pass` — read-only ticket state.

## Methods

- `initialize(env, admin, nft_contract)`
- `verify_and_issue_pass(env, player) -> BytesN<32>`
- `validate_pass(env, player, ticket_id) -> bool`
- `consume_pass(env, player, ticket_id)`
- `get_pass(env, ticket_id) -> AccessPass`

## Tests

```bash
cargo test
```

Covers: ticket issuance with NFT, rejection without NFT, single-use
enforcement, revocation on NFT transfer (and no un-revival), expiry, and
per-player ticket binding.
