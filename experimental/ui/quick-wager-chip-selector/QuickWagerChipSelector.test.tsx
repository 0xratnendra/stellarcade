import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QuickWagerChipSelector } from './QuickWagerChipSelector';

describe('QuickWagerChipSelector', () => {
  it('renders all default chips and accessible radiogroup', () => {
    render(
      <QuickWagerChipSelector
        selectedAmount={1}
        userBalance={1000}
        onSelectChip={vi.fn()}
      />,
    );

    const radiogroup = screen.getByRole('radiogroup', {
      name: /quick wager chip selector/i,
    });
    expect(radiogroup).toBeInTheDocument();

    const chips = screen.getAllByRole('radio');
    expect(chips).toHaveLength(5);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
  });

  it('clicking an enabled chip fires onSelectChip with chip value', () => {
    const handleSelect = vi.fn();
    const handlePlaySound = vi.fn();

    render(
      <QuickWagerChipSelector
        selectedAmount={1}
        userBalance={500}
        onSelectChip={handleSelect}
        onPlaySound={handlePlaySound}
      />,
    );

    const chip25 = screen.getByTestId('quick-wager-chip-25');
    fireEvent.click(chip25);

    expect(handleSelect).toHaveBeenCalledWith(25);
    expect(handlePlaySound).toHaveBeenCalledWith('select');
  });

  it('disables chips that exceed user balance', () => {
    const handleSelect = vi.fn();
    const handlePlaySound = vi.fn();

    render(
      <QuickWagerChipSelector
        selectedAmount={5}
        userBalance={20} // chips 25, 100, 500 should be disabled
        onSelectChip={handleSelect}
        onPlaySound={handlePlaySound}
      />,
    );

    const chip1 = screen.getByTestId('quick-wager-chip-1');
    const chip5 = screen.getByTestId('quick-wager-chip-5');
    const chip25 = screen.getByTestId('quick-wager-chip-25');
    const chip100 = screen.getByTestId('quick-wager-chip-100');
    const chip500 = screen.getByTestId('quick-wager-chip-500');

    expect(chip1).not.toBeDisabled();
    expect(chip5).not.toBeDisabled();
    expect(chip25).toBeDisabled();
    expect(chip100).toBeDisabled();
    expect(chip500).toBeDisabled();

    expect(chip25).toHaveAttribute('aria-disabled', 'true');

    // Clicking disabled chip should not call onSelectChip
    fireEvent.click(chip100);
    expect(handleSelect).not.toHaveBeenCalled();
    expect(handlePlaySound).toHaveBeenCalledWith('disabled');
  });

  it('keyboard arrow keys cycle between enabled chips', () => {
    const handleSelect = vi.fn();

    render(
      <QuickWagerChipSelector
        selectedAmount={5}
        userBalance={30} // enabled chips: 1, 5, 25
        onSelectChip={handleSelect}
      />,
    );

    const chip5 = screen.getByTestId('quick-wager-chip-5');
    chip5.focus();

    // ArrowRight should move from 5 to 25
    fireEvent.keyDown(chip5, { key: 'ArrowRight' });
    expect(handleSelect).toHaveBeenCalledWith(25);

    // ArrowLeft should move from 5 to 1
    fireEvent.keyDown(chip5, { key: 'ArrowLeft' });
    expect(handleSelect).toHaveBeenCalledWith(1);
  });

  it('double-click chip increments current total', () => {
    const handleSelect = vi.fn();
    const handlePlaySound = vi.fn();

    render(
      <QuickWagerChipSelector
        selectedAmount={25}
        userBalance={100}
        onSelectChip={handleSelect}
        onPlaySound={handlePlaySound}
      />,
    );

    const chip25 = screen.getByTestId('quick-wager-chip-25');
    fireEvent.doubleClick(chip25);

    // 25 + 25 = 50 <= balance (100)
    expect(handleSelect).toHaveBeenCalledWith(50);
    expect(handlePlaySound).toHaveBeenCalledWith('increment');
  });

  it('double-click does not increment if new total exceeds balance', () => {
    const handleSelect = vi.fn();
    const handlePlaySound = vi.fn();

    render(
      <QuickWagerChipSelector
        selectedAmount={25}
        userBalance={30}
        onSelectChip={handleSelect}
        onPlaySound={handlePlaySound}
      />,
    );

    const chip25 = screen.getByTestId('quick-wager-chip-25');
    fireEvent.doubleClick(chip25);

    // 25 + 25 = 50 > 30 -> blocked
    expect(handleSelect).not.toHaveBeenCalled();
    expect(handlePlaySound).toHaveBeenCalledWith('disabled');
  });

  it('marks selected chip with aria-checked="true"', () => {
    render(
      <QuickWagerChipSelector
        selectedAmount={100}
        userBalance={500}
        onSelectChip={vi.fn()}
      />,
    );

    const chip100 = screen.getByTestId('quick-wager-chip-100');
    expect(chip100).toHaveAttribute('aria-checked', 'true');

    const chip25 = screen.getByTestId('quick-wager-chip-25');
    expect(chip25).toHaveAttribute('aria-checked', 'false');
  });
});
