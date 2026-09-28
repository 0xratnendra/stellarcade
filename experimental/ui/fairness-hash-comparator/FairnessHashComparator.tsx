'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CardOutcome,
  CoinOutcome,
  DiceOutcome,
  FairnessHashComparatorProps,
  GameOutcomes,
  MatchStatus,
} from './types';
import './FairnessHashComparator.css';

// ---------------------------------------------------------------------------
// SHA-256 fallback (pure JS, FIPS 180-4) — used only when window.crypto.subtle
// is unavailable (older browsers, some SSR/test environments). Adapted from
// the sibling experimental/ui/provable-fairness-verifier widget's own
// fallback implementation, since both widgets share the same constraint.
// ---------------------------------------------------------------------------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256HexFallback(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const l1 = bytes.length + 1;
  const zeroPad = (64 - ((l1 + 8) % 64)) % 64;
  const paddedLen = l1 + zeroPad + 8;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, Math.floor(bitLength / 0x100000000));
  dv.setUint32(paddedLen - 4, bitLength >>> 0);

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(off + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes the SHA-256 hex digest of `input`, preferring the Web Crypto API
 * (`crypto.subtle.digest`) and falling back to a pure-JS implementation when
 * `crypto.subtle` is unavailable (non-secure contexts, older browsers, some
 * SSR/test environments).
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = typeof window !== 'undefined' ? window.crypto?.subtle : undefined;
  if (subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await subtle.digest('SHA-256', data);
    return bufferToHex(digest);
  }
  return sha256HexFallback(input);
}

export function deriveDiceOutcome(hashHex: string): DiceOutcome {
  return { kind: 'dice', roll: parseInt(hashHex.slice(0, 8), 16) % 100 };
}

export function deriveCoinOutcome(hashHex: string): CoinOutcome {
  return { kind: 'coin', side: parseInt(hashHex.slice(8, 10), 16) % 2 === 0 ? 'Heads' : 'Tails' };
}

const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const CARD_SUITS: CardOutcome['suit'][] = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];

export function deriveCardOutcome(hashHex: string): CardOutcome {
  const cardIndex = parseInt(hashHex.slice(10, 12), 16) % (CARD_RANKS.length * CARD_SUITS.length);
  return {
    kind: 'card',
    rank: CARD_RANKS[cardIndex % CARD_RANKS.length],
    suit: CARD_SUITS[Math.floor(cardIndex / CARD_RANKS.length) % CARD_SUITS.length],
  };
}

/** Derives dice/coin/card outcomes from a single combined-seed hash. */
export function deriveOutcomes(hashHex: string): GameOutcomes {
  return {
    dice: deriveDiceOutcome(hashHex),
    coin: deriveCoinOutcome(hashHex),
    card: deriveCardOutcome(hashHex),
  };
}

export function compareHashes(computedHex: string, expectedHex: string): MatchStatus {
  if (!computedHex || !expectedHex) return 'pending';
  return computedHex.trim().toLowerCase() === expectedHex.trim().toLowerCase()
    ? 'verified'
    : 'mismatch';
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  verified: 'Verified Fair',
  mismatch: 'Mismatch',
  pending: 'Pending',
};

export const FairnessHashComparator: React.FC<FairnessHashComparatorProps> = ({
  initialServerSeed = '',
  initialClientSeed = '',
  initialNonce = 0,
  expectedHash = '',
  testId = 'fairness-hash-comparator',
}) => {
  const [serverSeedHashed, setServerSeedHashed] = useState(false);
  const [serverSeed, setServerSeed] = useState(initialServerSeed);
  const [clientSeed, setClientSeed] = useState(initialClientSeed);
  const [nonceInput, setNonceInput] = useState(String(initialNonce));
  const [computedHash, setComputedHash] = useState('');
  const [copied, setCopied] = useState(false);

  const nonce = useMemo(() => {
    const parsed = parseInt(nonceInput, 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, [nonceInput]);

  // Re-derives the comparable hash whenever an input changes. When the
  // server seed is already hashed, it is compared directly; otherwise it is
  // hashed first, matching how a game receipt typically stores the hashed
  // commitment, not the raw seed.
  useEffect(() => {
    let cancelled = false;

    if (!serverSeed) {
      setComputedHash('');
      return;
    }

    (async () => {
      const hash = serverSeedHashed ? serverSeed.trim().toLowerCase() : await sha256Hex(serverSeed);
      if (!cancelled) setComputedHash(hash);
    })();

    return () => {
      cancelled = true;
    };
  }, [serverSeed, serverSeedHashed]);

  const status = useMemo(
    () => compareHashes(computedHash, expectedHash),
    [computedHash, expectedHash],
  );

  const [outcomes, setOutcomes] = useState<GameOutcomes | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!serverSeed || !clientSeed) {
      setOutcomes(null);
      return;
    }

    (async () => {
      const combinedHash = await sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
      if (!cancelled) setOutcomes(deriveOutcomes(combinedHash));
    })();

    return () => {
      cancelled = true;
    };
  }, [serverSeed, clientSeed, nonce]);

  const buildVerificationLink = useCallback((): string => {
    const params = new URLSearchParams({
      serverSeed,
      serverSeedHashed: String(serverSeedHashed),
      clientSeed,
      nonce: String(nonce),
      expectedHash,
    });
    const origin = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
    return `${origin}?${params.toString()}`;
  }, [serverSeed, serverSeedHashed, clientSeed, nonce, expectedHash]);

  const handleCopyLink = useCallback(async () => {
    const link = buildVerificationLink();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [buildVerificationLink]);

  return (
    <div className="fairness-hash-comparator" data-testid={testId}>
      <h2 className="fairness-hash-comparator__title">Fairness Hash Comparator</h2>
      <p className="fairness-hash-comparator__subtitle">
        Verify a game outcome by computing the SHA-256 hash of the server seed entirely in your
        browser and comparing it against the receipt hash.
      </p>

      <div className="fairness-hash-comparator__fields">
        <div className="fairness-hash-comparator__field">
          <label className="fairness-hash-comparator__label" htmlFor={`${testId}-server-seed`}>
            Server Seed
          </label>
          <input
            id={`${testId}-server-seed`}
            className="fairness-hash-comparator__input"
            type="text"
            value={serverSeed}
            onChange={(event) => setServerSeed(event.target.value)}
            placeholder="revealed server seed, or its hash"
            spellCheck={false}
          />
          <label className="fairness-hash-comparator__checkbox-row">
            <input
              type="checkbox"
              checked={serverSeedHashed}
              onChange={(event) => setServerSeedHashed(event.target.checked)}
              data-testid={`${testId}-server-seed-hashed-toggle`}
            />
            This is already the hashed server seed
          </label>
        </div>

        <div className="fairness-hash-comparator__field">
          <label className="fairness-hash-comparator__label" htmlFor={`${testId}-client-seed`}>
            Client Seed
          </label>
          <input
            id={`${testId}-client-seed`}
            className="fairness-hash-comparator__input"
            type="text"
            value={clientSeed}
            onChange={(event) => setClientSeed(event.target.value)}
            placeholder="player-facing client seed"
            spellCheck={false}
          />
        </div>

        <div className="fairness-hash-comparator__field">
          <label className="fairness-hash-comparator__label" htmlFor={`${testId}-nonce`}>
            Nonce
          </label>
          <input
            id={`${testId}-nonce`}
            className="fairness-hash-comparator__input"
            type="number"
            min={0}
            value={nonceInput}
            onChange={(event) => setNonceInput(event.target.value)}
          />
        </div>
      </div>

      <div
        className="fairness-hash-comparator__results"
        role="status"
        aria-live="polite"
        data-testid={`${testId}-results`}
      >
        <div className="fairness-hash-comparator__result-row">
          <span className="fairness-hash-comparator__result-label">Computed Hash</span>
          <code className="fairness-hash-comparator__hash" data-testid={`${testId}-computed-hash`}>
            {computedHash || '—'}
          </code>
        </div>

        <div
          className={`fairness-hash-comparator__status-pill fairness-hash-comparator__status-pill--${status}`}
          data-testid={`${testId}-status`}
        >
          {STATUS_LABEL[status]}
        </div>

        {outcomes && (
          <div className="fairness-hash-comparator__outcomes" data-testid={`${testId}-outcomes`}>
            <div className="fairness-hash-comparator__outcome">
              <span className="fairness-hash-comparator__outcome-label">Dice</span>
              <span data-testid={`${testId}-outcome-dice`}>{outcomes.dice.roll}</span>
            </div>
            <div className="fairness-hash-comparator__outcome">
              <span className="fairness-hash-comparator__outcome-label">Coin</span>
              <span data-testid={`${testId}-outcome-coin`}>{outcomes.coin.side}</span>
            </div>
            <div className="fairness-hash-comparator__outcome">
              <span className="fairness-hash-comparator__outcome-label">Card</span>
              <span data-testid={`${testId}-outcome-card`}>
                {outcomes.card.rank} of {outcomes.card.suit}
              </span>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="fairness-hash-comparator__copy-btn"
        onClick={handleCopyLink}
        data-testid={`${testId}-copy-link`}
      >
        {copied ? 'Copied!' : 'Copy Verification Link'}
      </button>
    </div>
  );
};

FairnessHashComparator.displayName = 'FairnessHashComparator';
export default FairnessHashComparator;
