# Quick Wager Chip Selector Strip

An arcade-styled casino poker chip selector strip for the experimental workspace, allowing 1-click wager sizing in arcade duels.

## Features

- **Tactile 3D-styled token chips**: Distinct color values according to casino conventions (1 XLM white, 5 XLM red, 25 XLM green, 100 XLM black/gold, 500 XLM purple).
- **Active selection ring**: High-contrast glow and elevation when a chip is active.
- **Double-click incrementation**: Double-clicking an enabled chip adds its value incrementally to the current total.
- **Dynamic balance guarding**: Disables chips and prevents selection when the value exceeds the user's available balance.
- **Sound effect triggers**: Optional `onPlaySound` callback supporting `select`, `increment`, and `disabled` events.
- **Accessible keyboard navigation**: Full `role="radiogroup"` and `role="radio"` semantics, with arrow keys (Right/Down and Left/Up) cycling between enabled chips.

## Installation / Target

```
experimental/ui/quick-wager-chip-selector/
```

## Usage

```tsx
import React, { useState } from 'react';
import { QuickWagerChipSelector } from './QuickWagerChipSelector';

export const DuelWagerBar = () => {
  const [wager, setWager] = useState(25);
  const balance = 350;

  return (
    <QuickWagerChipSelector
      availableChips={[1, 5, 25, 100, 500]}
      selectedAmount={wager}
      userBalance={balance}
      onSelectChip={(val) => setWager(val)}
      onPlaySound={(type) => console.log('Playing sound:', type)}
    />
  );
};
```

## Props

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `availableChips` | `number[]` | `[1, 5, 25, 100, 500]` | Available chip denominations |
| `selectedAmount` | `number` | **required** | Currently selected wager amount |
| `userBalance` | `number` | **required** | Player's balance in XLM |
| `onSelectChip` | `(value: number) => void` | **required** | Callback when chip is selected or incremented |
| `onPlaySound` | `(type: 'select' \| 'increment' \| 'disabled') => void` | `undefined` | Audio callback for tactile sound effects |
| `className` | `string` | `''` | Extra CSS class names |
| `testId` | `string` | `'quick-wager-chip-selector'` | Component test identifier |

## Testing

Run unit tests via Vitest:

```bash
vitest run experimental/ui/quick-wager-chip-selector/QuickWagerChipSelector.test.tsx
```
