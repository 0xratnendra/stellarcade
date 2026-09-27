# Tournament Bracket Simulator

A TypeScript library and CLI tool for generating balanced single and double elimination tournament brackets with power-of-two bye allocation and seed shuffling.

## API Usage

```typescript
import { generateTournamentBracket } from '@stellarcade/tournament-bracket-simulator';

const players = [
  { id: 'p1', name: 'Alice', seed: 1 },
  { id: 'p2', name: 'Bob', seed: 2 },
  { id: 'p3', name: 'Charlie', seed: 3 },
];

const bracket = generateTournamentBracket(players, 'single');
console.log(JSON.stringify(bracket, null, 2));
```
