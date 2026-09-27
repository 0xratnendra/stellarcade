import { describe, it, expect } from 'vitest';
import {
  generateTournamentBracket,
  simulateRoundAdvancement,
  getTotalMatchesCount,
  PlayerSeed,
} from './index';

function createMockPlayers(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
  }));
}

describe('tournament-bracket-simulator', () => {
  it('generates single elimination bracket for 8 players producing 7 total matches', () => {
    const players = createMockPlayers(8);
    const bracket = generateTournamentBracket(players, 'single');

    expect(bracket.totalPlayers).toBe(8);
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.byesCount).toBe(0);

    const totalMatches = getTotalMatchesCount(bracket);
    expect(totalMatches).toBe(7); // 4 + 2 + 1 = 7 matches
  });

  it('allocates byes correctly for odd player count (e.g. 7 players)', () => {
    const players = createMockPlayers(7);
    const bracket = generateTournamentBracket(players, 'single');

    expect(bracket.totalPlayers).toBe(7);
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.byesCount).toBe(1);

    const r1Matches = bracket.winnersRounds[0].matches;
    const byeMatches = r1Matches.filter((m) => m.isBye);
    expect(byeMatches.length).toBe(1);
    expect(byeMatches[0].winner).toBeDefined();
    expect(byeMatches[0].winner?.seed).toBe(1); // #1 seed gets bye
  });

  it('updates winner advancement correctly during simulation', () => {
    const players = createMockPlayers(4);
    const bracket = generateTournamentBracket(players, 'single');

    const m1 = bracket.winnersRounds[0].matches[0]; // Player 1 vs Player 4
    expect(m1.player1?.id).toBe('p1');
    expect(m1.player2?.id).toBe('p4');

    const updatedM1 = simulateRoundAdvancement(m1, 'p1');
    expect(updatedM1.winner?.id).toBe('p1');
    expect(updatedM1.loser?.id).toBe('p4');
  });

  it('supports double elimination structure output format', () => {
    const players = createMockPlayers(8);
    const bracket = generateTournamentBracket(players, 'double');

    expect(bracket.type).toBe('double');
    expect(bracket.losersRounds).toBeDefined();
    expect(bracket.grandFinal).toBeDefined();
  });
});
