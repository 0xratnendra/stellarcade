# Quest Countdown Timer Widget

A compact countdown card showing remaining time for a daily quest reset
or weekly epoch bounty, with a digital `HH:MM:SS` clock, an urgent pulse
under 1 hour remaining, and an expired "Refreshing quests..." banner.

> **Status:** experimental, self-contained component under
> `experimental/ui/`. It does not modify the core `apps/web/` dashboard.

## Props

See `types.ts` for `QuestCountdownTimerWidgetProps`. `targetResetTimestamp`
accepts either an ISO timestamp string or epoch milliseconds.

## Avoiding timer drift

`computeRemainingTime` (exported for direct testing) recomputes the
remaining duration from `Date.now()` against the fixed target timestamp
on every tick, rather than decrementing a stored counter. Decrementing
drifts against wall-clock time whenever a tick is delayed (a busy main
thread, a backgrounded tab throttling `setInterval`); recomputing from
absolute timestamps is always exactly correct regardless of how late or
early a given tick actually fires.

## Behavior

- `onExpire` fires exactly once, the first tick where remaining time
  reaches zero; further ticks after expiry do not re-fire it, and
  unmounting before expiry means it never fires at all.
- The countdown interval is cleared on unmount.
- The urgent pulse class applies whenever remaining time is under 1 hour
  AND the countdown has not yet expired (the expired banner takes
  precedence once it has).

## Installation

```bash
cd experimental/ui/quest-countdown-timer-widget
npm install
```

## Testing

```bash
npm test
```
