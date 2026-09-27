# VIP Level Progress Tracker

A VIP tier progress card showing a metallic-gradient tier badge (Bronze,
Silver, Gold, Platinum), a progress bar toward the next tier's point
threshold, and a perk unlock checklist.

> **Status:** experimental, self-contained component under
> `experimental/ui/`. It does not modify production rewards or profile
> pages.

## Props

See `types.ts` for `VipLevelProgressTrackerProps`. Notably,
`nextTierPoints <= currentPoints` is treated as "maximum tier reached":
there is no meaningful progress bar to show when there's no further tier
to progress toward, so the component renders a "Maximum Tier Reached"
banner instead.

## Behavior

- **Progress bar** — `computeProgressPercent` (exported for direct
  testing) clamps its result to `[0, 100]` and returns `0` if
  `nextTierPoints` is zero or negative, avoiding a division by zero. The
  bar carries `role="progressbar"` with `aria-valuenow`/`aria-valuemin`/
  `aria-valuemax`.
- **Max tier** — `isMaxTier` (also exported) is the single source of truth
  for the max-tier banner vs. progress-bar decision.
- **Perks** — each perk in the `perks` array renders with a checkmark and
  an "unlocked" styling class when `unlocked` is `true`, or a bullet and
  dimmed styling otherwise.

## Installation

```bash
cd experimental/ui/vip-level-progress-tracker
npm install
```

## Testing

```bash
npm test
```
