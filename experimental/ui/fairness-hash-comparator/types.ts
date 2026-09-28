export type MatchStatus = 'verified' | 'mismatch' | 'pending';

export interface DiceOutcome {
  kind: 'dice';
  roll: number; // 0-99
}

export interface CoinOutcome {
  kind: 'coin';
  side: 'Heads' | 'Tails';
}

export interface CardOutcome {
  kind: 'card';
  rank: string; // "2".."10", "J", "Q", "K", "A"
  suit: 'Spades' | 'Hearts' | 'Diamonds' | 'Clubs';
}

export interface GameOutcomes {
  dice: DiceOutcome;
  coin: CoinOutcome;
  card: CardOutcome;
}

export interface FairnessHashComparatorProps {
  /** Prefills the (unhashed) server seed input. */
  initialServerSeed?: string;
  /** Prefills the player-facing client seed input. */
  initialClientSeed?: string;
  /** Prefills the round nonce input. */
  initialNonce?: number;
  /** The hash to compare the computed server-seed hash against (the game receipt's hash). */
  expectedHash?: string;
  /** Optional root test id override. */
  testId?: string;
}
