# Token Balance Refresh Chip

A compact balance badge showing a token icon, formatted balance, and a
manual refresh button with a spin animation, a pulse glow on balance
increases, and a disconnected-wallet fallback state.

> **Status:** experimental, self-contained component under
> `experimental/ui/`. It does not modify `apps/web`'s navigation header.

## Props

See `types.ts` for `TokenBalanceRefreshChipProps`:

- `balance`, `symbol`: the core display. `balance` of `null`/`undefined`
  renders "Wallet disconnected" instead of a numeric value.
- `icon` (optional): rendered before the symbol.
- `isRefreshing`, `onRefresh` (optional): drive the refresh button's
  spinning state and click handler. The button is omitted entirely when
  `onRefresh` isn't provided.
- `lastSyncedAt` (optional): an ISO 8601 timestamp shown in the refresh
  button's tooltip.
- `precision` (optional, default `2`): decimal places in the formatted
  balance.

## Behavior

- **Formatting**: `formatBalance` (exported for direct testing) uses
  `toLocaleString('en-US', ...)` for comma thousands separators and a
  fixed decimal precision.
- **Pulse on increase**: comparing the current render's `balance` against
  the previous one via a ref; a pulse glow class is applied for ~900ms
  when the balance goes up, and never on a decrease or no change.
- **Accessibility**: the refresh button carries `aria-busy` reflecting
  `isRefreshing`, and is disabled both while refreshing and while
  disconnected.

## Installation

```bash
cd experimental/ui/token-balance-refresh-chip
npm install
```

## Testing

```bash
npm test
```
