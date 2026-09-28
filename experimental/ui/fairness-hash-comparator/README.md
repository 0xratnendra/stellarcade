# Fairness Hash Comparator

An interactive provably-fair verification widget: players paste a server seed, client seed, and
nonce, and the widget computes the SHA-256 hash client-side using the Web Crypto API and compares
it against the game receipt's hash.

## Usage

```tsx
import { FairnessHashComparator } from './fairness-hash-comparator/FairnessHashComparator';

function VerifyRound() {
  return (
    <FairnessHashComparator
      initialServerSeed="server-secret-seed-42"
      initialClientSeed="player-seed-7"
      initialNonce={3}
      expectedHash="a1b2c3d4..." // the hash recorded on the game receipt
    />
  );
}
```

## Props

| Prop | Type | Description |
|---|---|---|
| `initialServerSeed` | `string?` | Prefills the server seed input (hashed or unhashed; see the toggle). |
| `initialClientSeed` | `string?` | Prefills the player-facing client seed input. |
| `initialNonce` | `number?` | Prefills the round nonce input. |
| `expectedHash` | `string?` | The hash to compare the computed server-seed hash against (the game receipt's hash). |
| `testId` | `string?` | Optional root test id override. |

## Features

- Server Seed, Client Seed, and Nonce inputs, plus a toggle for whether the pasted server seed is
  already hashed or needs hashing first.
- Real-time client-side SHA-256 via `crypto.subtle.digest`, with a pure-JS fallback (FIPS 180-4)
  for environments where `crypto.subtle` is unavailable.
- Status pill comparing the computed hash against `expectedHash`: **Verified Fair** (green),
  **Mismatch** (red), **Pending** (gray).
- Dice (0-99), coin (Heads/Tails), and card (rank + suit) outcome simulation, all derived
  deterministically from `SHA-256(serverSeed:clientSeed:nonce)`.
- "Copy Verification Link" button that copies a URL encoding the current inputs for sharing.

## Outcome formula

```
combined = `${serverSeed}:${clientSeed}:${nonce}`
hash     = SHA-256(combined)
dice     = parseInt(hash[0..7],  16) % 100     // 0-99
coin     = parseInt(hash[8..9],  16) % 2 === 0 ? "Heads" : "Tails"
card     = parseInt(hash[10..11],16) % 52      // rank + suit, 13 ranks x 4 suits
```

Hash verification compares the server seed's SHA-256 (or the seed itself, if the hashed-seed
toggle is on) against `expectedHash`, case-insensitively.

## Accessibility

- Every input has a visible `<label>` tied via `htmlFor`/`id`.
- The results panel is a `role="status"` region with `aria-live="polite"`.
- Status pills carry distinct text and color, never color alone.

## Testing

```bash
cd experimental/ui/fairness-hash-comparator
npm install
npm test
```

Covered scenarios:

- A matching computed hash renders the green "Verified Fair" badge.
- A mismatched hash renders the red "Mismatch" alert.
- No server seed yet renders "Pending".
- The hashed-seed toggle compares the raw input directly instead of re-hashing it.
- Dice/coin/card outcomes render once both seeds are present.
- Copy Verification Link writes to the clipboard.
- `sha256Hex` matches known SHA-256 test vectors (empty string, `"abc"`).
