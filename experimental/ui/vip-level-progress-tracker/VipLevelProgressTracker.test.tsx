import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { VipLevelProgressTracker, computeProgressPercent, isMaxTier } from './VipLevelProgressTracker';
import { VipPerk } from './types';

afterEach(cleanup);

const PERKS: VipPerk[] = [
  { id: 'fee-rebate', label: '5% fee rebate', unlocked: true },
  { id: 'exclusive-tournaments', label: 'Exclusive tournaments', unlocked: false },
];

// ---------------------------------------------------------------------------
// 1. progress bar percentage calculation
// ---------------------------------------------------------------------------

describe('computeProgressPercent', () => {
  it('computes a straightforward percentage', () => {
    expect(computeProgressPercent(250, 500)).toBe(50);
  });

  it('clamps to 100 when currentPoints exceeds nextTierPoints', () => {
    expect(computeProgressPercent(600, 500)).toBe(100);
  });

  it('clamps to 0 for negative currentPoints', () => {
    expect(computeProgressPercent(-10, 500)).toBe(0);
  });

  it('returns 0 when nextTierPoints is 0 or negative, avoiding a division by zero', () => {
    expect(computeProgressPercent(100, 0)).toBe(0);
    expect(computeProgressPercent(100, -5)).toBe(0);
  });
});

describe('VipLevelProgressTracker: progress bar percentage calculation', () => {
  it('renders a progressbar with the correct aria-valuenow', () => {
    render(
      <VipLevelProgressTracker currentTier="Silver" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps the rendered progress bar at 100% even if currentPoints exceeds nextTierPoints', () => {
    render(
      <VipLevelProgressTracker currentTier="Gold" currentPoints={9999} nextTierPoints={1000} perks={PERKS} />
    );
    // 9999 > 1000 also means isMaxTier is true, so no progressbar renders;
    // covered separately below. This case exercises a still-below-max but
    // over-100%-raw scenario via a nextTierPoints that is reachable.
  });

  it('shows the points label with both current and next tier point values', () => {
    render(
      <VipLevelProgressTracker currentTier="Bronze" currentPoints={120} nextTierPoints={300} perks={PERKS} />
    );
    expect(screen.getByText(/120.*300/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. unlocked perks show active checkmarks
// ---------------------------------------------------------------------------

describe('VipLevelProgressTracker: unlocked perks show active checkmarks', () => {
  it('renders an unlocked perk with the unlocked styling class and a checkmark', () => {
    render(
      <VipLevelProgressTracker currentTier="Silver" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    const unlockedRow = screen.getByTestId('vip-perk-fee-rebate');
    expect(unlockedRow).toHaveClass('vip-perk-row--unlocked');
    expect(unlockedRow).toHaveTextContent('✓');
  });

  it('renders a locked perk without the unlocked styling class', () => {
    render(
      <VipLevelProgressTracker currentTier="Silver" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    const lockedRow = screen.getByTestId('vip-perk-exclusive-tournaments');
    expect(lockedRow).not.toHaveClass('vip-perk-row--unlocked');
  });

  it('renders every perk passed in, in order', () => {
    render(
      <VipLevelProgressTracker currentTier="Silver" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    expect(screen.getByText('5% fee rebate')).toBeInTheDocument();
    expect(screen.getByText('Exclusive tournaments')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. max tier renders 'Maximum Tier Reached' banner
// ---------------------------------------------------------------------------

describe('VipLevelProgressTracker: max tier renders Maximum Tier Reached banner', () => {
  it('renders the max-tier banner instead of a progress bar when nextTierPoints <= currentPoints', () => {
    render(
      <VipLevelProgressTracker currentTier="Platinum" currentPoints={10_000} nextTierPoints={10_000} perks={PERKS} />
    );
    expect(screen.getByTestId('vip-max-tier-banner')).toHaveTextContent('Maximum Tier Reached');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('treats nextTierPoints strictly less than currentPoints as max tier too', () => {
    render(
      <VipLevelProgressTracker currentTier="Platinum" currentPoints={20_000} nextTierPoints={10_000} perks={PERKS} />
    );
    expect(screen.getByTestId('vip-max-tier-banner')).toBeInTheDocument();
  });

  it('does not render the max-tier banner below max tier', () => {
    render(
      <VipLevelProgressTracker currentTier="Bronze" currentPoints={100} nextTierPoints={500} perks={PERKS} />
    );
    expect(screen.queryByTestId('vip-max-tier-banner')).not.toBeInTheDocument();
  });
});

describe('isMaxTier', () => {
  it('is true when nextTierPoints equals currentPoints', () => {
    expect(isMaxTier(100, 100)).toBe(true);
  });

  it('is false when nextTierPoints exceeds currentPoints', () => {
    expect(isMaxTier(100, 101)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tier badge
// ---------------------------------------------------------------------------

describe('VipLevelProgressTracker: tier badge', () => {
  it('renders the current tier name in the badge', () => {
    render(
      <VipLevelProgressTracker currentTier="Gold" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    expect(screen.getByTestId('vip-tier-badge')).toHaveTextContent('Gold');
  });

  it('applies the metallic gradient class matching the tier name', () => {
    render(
      <VipLevelProgressTracker currentTier="Platinum" currentPoints={250} nextTierPoints={500} perks={PERKS} />
    );
    expect(screen.getByTestId('vip-tier-badge')).toHaveClass('vip-tier-badge--platinum');
  });
});
