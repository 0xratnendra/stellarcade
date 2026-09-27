# Provable Seed History Drawer

Slide-out seed history and rotation drawer for experimental workspace.

## Usage
```tsx
import { ProvableSeedHistoryDrawer } from "./ProvableSeedHistoryDrawer";

<ProvableSeedHistoryDrawer
  isOpen={isOpen}
  seeds={seeds}
  onRotateSeed={() => rotateSeed()}
  onClose={() => setIsOpen(false)}
/>
```
