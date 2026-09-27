export interface PlayerSeed {
  id: string;
  name: string;
  seed: number;
}

export interface MatchPairing {
  id: string;
  round: number;
  matchIndex: number;
  player1?: PlayerSeed;
  player2?: PlayerSeed;
  winner?: PlayerSeed;
  loser?: PlayerSeed;
  isBye?: boolean;
  nextMatchId?: string;
  nextLoserMatchId?: string;
}

export interface BracketRound {
  round: number;
  name: string;
  matches: MatchPairing[];
}

export interface BracketTree {
  type: 'single' | 'double';
  totalPlayers: number;
  bracketSize: number;
  byesCount: number;
  winnersRounds: BracketRound[];
  losersRounds?: BracketRound[];
  grandFinal?: MatchPairing;
}

function nextPowerOfTwo(n: number): number {
  let count = 1;
  while (count < n) {
    count <<= 1;
  }
  return count;
}

export function generateSeededOrder(size: number): number[] {
  if (size === 1) return [1];
  if (size === 2) return [1, 2];

  let seeds = [1, 2];
  while (seeds.length < size) {
    const nextSeeds: number[] = [];
    const currentSize = seeds.length * 2 + 1;
    for (const seed of seeds) {
      nextSeeds.push(seed);
      nextSeeds.push(currentSize - seed);
    }
    seeds = nextSeeds;
  }
  return seeds;
}

export function generateTournamentBracket(
  players: PlayerSeed[],
  type: 'single' | 'double' = 'single',
): BracketTree {
  if (players.length < 2) {
    throw new Error('At least 2 players are required to generate a tournament bracket.');
  }

  const sortedPlayers = [...players].sort((a, b) => a.seed - b.seed);
  const totalPlayers = sortedPlayers.length;
  const bracketSize = nextPowerOfTwo(totalPlayers);
  const byesCount = bracketSize - totalPlayers;

  // Build round 1 match slots according to standard seeded order
  const seededOrder = generateSeededOrder(bracketSize);
  const playerMap = new Map<number, PlayerSeed>();
  sortedPlayers.forEach((p) => playerMap.set(p.seed, p));

  const totalRounds = Math.log2(bracketSize);
  const winnersRounds: BracketRound[] = [];

  // Generate round 1 matches
  const round1Matches: MatchPairing[] = [];
  const numR1Matches = bracketSize / 2;

  for (let i = 0; i < numR1Matches; i++) {
    const seed1 = seededOrder[i * 2];
    const seed2 = seededOrder[i * 2 + 1];

    const p1 = playerMap.get(seed1);
    const p2 = playerMap.get(seed2);
    const isBye = !p1 || !p2;
    const winner = isBye ? (p1 || p2) : undefined;

    round1Matches.push({
      id: `W-R1-M${i + 1}`,
      round: 1,
      matchIndex: i,
      player1: p1,
      player2: p2,
      isBye,
      winner,
    });
  }

  winnersRounds.push({
    round: 1,
    name: `Round 1`,
    matches: round1Matches,
  });

  // Generate subsequent rounds for winners bracket
  let currentMatchesCount = numR1Matches;
  for (let r = 2; r <= totalRounds; r++) {
    currentMatchesCount /= 2;
    const matches: MatchPairing[] = [];
    const prevMatches = winnersRounds[r - 2].matches;

    for (let i = 0; i < currentMatchesCount; i++) {
      const matchId = `W-R${r}-M${i + 1}`;
      const m1 = prevMatches[i * 2];
      const m2 = prevMatches[i * 2 + 1];

      m1.nextMatchId = matchId;
      m2.nextMatchId = matchId;

      const p1 = m1.isBye ? m1.winner : undefined;
      const p2 = m2.isBye ? m2.winner : undefined;
      const isBye = Boolean(p1 && p2 && m1.isBye && m2.isBye);

      matches.push({
        id: matchId,
        round: r,
        matchIndex: i,
        player1: p1,
        player2: p2,
        isBye,
        winner: isBye ? p1 : undefined,
      });
    }

    const roundName = r === totalRounds ? 'Finals' : r === totalRounds - 1 ? 'Semi-Finals' : `Round ${r}`;
    winnersRounds.push({
      round: r,
      name: roundName,
      matches,
    });
  }

  const result: BracketTree = {
    type,
    totalPlayers,
    bracketSize,
    byesCount,
    winnersRounds,
  };

  if (type === 'double') {
    // Generate simplified double elimination structure representation
    const losersRounds: BracketRound[] = [];
    let numLMatches = Math.floor(numR1Matches / 2) || 1;
    for (let lr = 1; lr <= totalRounds - 1; lr++) {
      const matches: MatchPairing[] = [];
      for (let i = 0; i < numLMatches; i++) {
        matches.push({
          id: `L-R${lr}-M${i + 1}`,
          round: lr,
          matchIndex: i,
        });
      }
      losersRounds.push({
        round: lr,
        name: `Losers Round ${lr}`,
        matches,
      });
    }
    result.losersRounds = losersRounds;
    result.grandFinal = {
      id: `GF-M1`,
      round: totalRounds + 1,
      matchIndex: 0,
    };
  }

  return result;
}

export function simulateRoundAdvancement(match: MatchPairing, winningPlayerId: string): MatchPairing {
  if (!match.player1 || !match.player2) {
    throw new Error('Match requires both players before simulating advancement');
  }

  const winner = match.player1.id === winningPlayerId ? match.player1 : match.player2.id === winningPlayerId ? match.player2 : undefined;
  if (!winner) {
    throw new Error(`Player ${winningPlayerId} is not in match ${match.id}`);
  }

  const loser = winner.id === match.player1.id ? match.player2 : match.player1;
  match.winner = winner;
  match.loser = loser;
  return match;
}

export function getTotalMatchesCount(bracket: BracketTree): number {
  return bracket.winnersRounds.reduce((acc, r) => acc + r.matches.length, 0);
}
