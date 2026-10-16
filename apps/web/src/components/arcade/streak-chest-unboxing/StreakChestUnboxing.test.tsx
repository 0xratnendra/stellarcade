import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import {
  StreakChestUnboxing,
  nextPhaseAfterUnlock,
} from './StreakChestUnboxing';

afterEach(cleanup);

const reward = {
  id: 'reward-1',
  name: 'Stellar Shard',
  tier: 'Epic',
  amount: 250,
  symbol: 'XLM',
};

describe('StreakChestUnboxing', () => {
  it('toggles modal visibility and exposes dialog accessibility', () => {
    const { rerender } = render(
      <StreakChestUnboxing
        isOpen={false}
        chestTier="gold"
        reward={reward}
        onClaim={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('streak-chest-dialog')).not.toBeInTheDocument();

    rerender(
      <StreakChestUnboxing
        isOpen
        chestTier="gold"
        reward={reward}
        onClaim={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId('streak-chest-dialog');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Daily quest streak chest unboxing');
  });

  it('progresses animation to reward reveal after unlock', () => {
    vi.useFakeTimers();
    render(
      <StreakChestUnboxing
        isOpen
        chestTier="silver"
        reward={reward}
        onClaim={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('streak-chest-unlock'));
    expect(screen.getByTestId('streak-chest-dialog')).toHaveAttribute('data-phase', 'shaking');
    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByTestId('streak-chest-loot')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('invokes onClaim with the reward id', () => {
    vi.useFakeTimers();
    const onClaim = vi.fn();
    render(
      <StreakChestUnboxing
        isOpen
        chestTier="diamond"
        reward={reward}
        onClaim={onClaim}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('streak-chest-unlock'));
    act(() => {
      vi.runAllTimers();
    });
    fireEvent.click(screen.getByTestId('streak-chest-claim'));
    expect(onClaim).toHaveBeenCalledWith('reward-1');
    vi.useRealTimers();
  });

  it('calls onClose when dismiss is clicked', () => {
    const onClose = vi.fn();
    render(
      <StreakChestUnboxing
        isOpen
        chestTier="bronze"
        reward={reward}
        onClaim={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('streak-chest-dismiss'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nextPhaseAfterUnlock advances shaking to opened', () => {
    expect(nextPhaseAfterUnlock('shaking')).toBe('opened');
  });
});
