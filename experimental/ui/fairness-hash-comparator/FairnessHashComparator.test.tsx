import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import {
  FairnessHashComparator,
  sha256Hex,
  compareHashes,
  deriveOutcomes,
  deriveDiceOutcome,
  deriveCoinOutcome,
  deriveCardOutcome,
} from './FairnessHashComparator';

afterEach(cleanup);

describe('sha256Hex', () => {
  it('computes the known SHA-256 digest of an empty string', async () => {
    const hash = await sha256Hex('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes the known SHA-256 digest of "abc"', async () => {
    const hash = await sha256Hex('abc');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces a 64-character hex string', async () => {
    const hash = await sha256Hex('some seed value');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('compareHashes', () => {
  it('is pending when either side is empty', () => {
    expect(compareHashes('', 'abc')).toBe('pending');
    expect(compareHashes('abc', '')).toBe('pending');
  });

  it('is verified for a case-insensitive exact match', () => {
    expect(compareHashes('ABCDEF', 'abcdef')).toBe('verified');
  });

  it('is mismatch for differing hashes', () => {
    expect(compareHashes('abcdef', '123456')).toBe('mismatch');
  });
});

describe('outcome derivation', () => {
  it('derives a dice roll in [0, 99]', () => {
    const outcome = deriveDiceOutcome('0'.repeat(64));
    expect(outcome.roll).toBeGreaterThanOrEqual(0);
    expect(outcome.roll).toBeLessThan(100);
  });

  it('derives a coin side of Heads or Tails', () => {
    const outcome = deriveCoinOutcome('0'.repeat(64));
    expect(['Heads', 'Tails']).toContain(outcome.side);
  });

  it('derives a card with a valid rank and suit', () => {
    const outcome = deriveCardOutcome('0'.repeat(64));
    expect(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']).toContain(
      outcome.rank,
    );
    expect(['Spades', 'Hearts', 'Diamonds', 'Clubs']).toContain(outcome.suit);
  });

  it('deriveOutcomes returns all three consistently from one hash', () => {
    const hash = 'a'.repeat(64);
    const outcomes = deriveOutcomes(hash);
    expect(outcomes.dice).toEqual(deriveDiceOutcome(hash));
    expect(outcomes.coin).toEqual(deriveCoinOutcome(hash));
    expect(outcomes.card).toEqual(deriveCardOutcome(hash));
  });
});

describe('FairnessHashComparator', () => {
  it('shows Verified Fair when the computed hash matches expectedHash', async () => {
    const serverSeed = 'server-secret-seed-42';
    const expectedHash = await sha256Hex(serverSeed);

    render(
      <FairnessHashComparator initialServerSeed={serverSeed} expectedHash={expectedHash} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveTextContent(
        'Verified Fair',
      );
    });
    expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveClass(
      'fairness-hash-comparator__status-pill--verified',
    );
  });

  it('shows Mismatch when the computed hash does not match expectedHash', async () => {
    render(
      <FairnessHashComparator initialServerSeed="some-seed" expectedHash="deadbeef" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveTextContent('Mismatch');
    });
    expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveClass(
      'fairness-hash-comparator__status-pill--mismatch',
    );
  });

  it('shows Pending when there is no server seed yet', () => {
    render(<FairnessHashComparator expectedHash="deadbeef" />);

    expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveTextContent('Pending');
    expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveClass(
      'fairness-hash-comparator__status-pill--pending',
    );
  });

  it('compares against the raw seed hash directly when the hashed-seed toggle is checked', async () => {
    const alreadyHashed = 'a'.repeat(64);

    render(<FairnessHashComparator expectedHash={alreadyHashed} />);

    fireEvent.change(screen.getByLabelText('Server Seed'), {
      target: { value: alreadyHashed },
    });
    fireEvent.click(screen.getByTestId('fairness-hash-comparator-server-seed-hashed-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('fairness-hash-comparator-status')).toHaveTextContent(
        'Verified Fair',
      );
    });
  });

  it('renders dice, coin, and card outcomes once server and client seeds are set', async () => {
    render(
      <FairnessHashComparator
        initialServerSeed="server-secret-seed-42"
        initialClientSeed="player-seed-7"
        initialNonce={3}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('fairness-hash-comparator-outcomes')).toBeInTheDocument();
    });

    expect(screen.getByTestId('fairness-hash-comparator-outcome-dice')).toBeInTheDocument();
    expect(screen.getByTestId('fairness-hash-comparator-outcome-coin')).toHaveTextContent(
      /Heads|Tails/,
    );
    expect(screen.getByTestId('fairness-hash-comparator-outcome-card')).toBeInTheDocument();
  });

  it('copies a verification link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<FairnessHashComparator initialServerSeed="seed" initialClientSeed="client" />);

    fireEvent.click(screen.getByTestId('fairness-hash-comparator-copy-link'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('serverSeed=seed');
  });
});
