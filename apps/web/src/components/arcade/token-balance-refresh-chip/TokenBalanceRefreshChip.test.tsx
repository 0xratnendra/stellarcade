import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { TokenBalanceRefreshChip, formatBalance } from './TokenBalanceRefreshChip';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// 1. formatted balance output string
// ---------------------------------------------------------------------------

describe('formatBalance', () => {
  it('formats a balance with comma thousands separators and 2 decimal places by default', () => {
    expect(formatBalance(1234567.5)).toBe('1,234,567.50');
  });

  it('formats a small balance without unnecessary separators', () => {
    expect(formatBalance(42)).toBe('42.00');
  });

  it('respects a custom precision', () => {
    expect(formatBalance(1000.123456, 4)).toBe('1,000.1235');
  });

  it('formats zero correctly', () => {
    expect(formatBalance(0)).toBe('0.00');
  });
});

describe('TokenBalanceRefreshChip: renders formatted balance', () => {
  it('renders the formatted balance and symbol', () => {
    render(<TokenBalanceRefreshChip balance={1234567.5} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-value')).toHaveTextContent('1,234,567.50');
    expect(screen.getByTestId('token-balance-value')).toHaveTextContent('XLM');
  });

  it('renders the disconnected fallback when balance is null', () => {
    render(<TokenBalanceRefreshChip balance={null} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-disconnected')).toHaveTextContent('Wallet disconnected');
    expect(screen.queryByTestId('token-balance-value')).not.toBeInTheDocument();
  });

  it('renders the disconnected fallback when balance is undefined', () => {
    render(<TokenBalanceRefreshChip balance={undefined} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-disconnected')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. refresh button click triggers onRefresh
// ---------------------------------------------------------------------------

describe('TokenBalanceRefreshChip: refresh button click triggers onRefresh', () => {
  it('calls onRefresh when the refresh button is clicked', () => {
    const onRefresh = vi.fn();
    render(<TokenBalanceRefreshChip balance={100} symbol="XLM" onRefresh={onRefresh} />);
    fireEvent.click(screen.getByLabelText('Refresh balance'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not render a refresh button when onRefresh is not provided', () => {
    render(<TokenBalanceRefreshChip balance={100} symbol="XLM" />);
    expect(screen.queryByLabelText('Refresh balance')).not.toBeInTheDocument();
  });

  it('disables the refresh button while disconnected', () => {
    const onRefresh = vi.fn();
    render(<TokenBalanceRefreshChip balance={null} symbol="XLM" onRefresh={onRefresh} />);
    expect(screen.getByLabelText('Refresh balance')).toBeDisabled();
  });

  it('shows the last-synced timestamp in the refresh button tooltip', () => {
    render(
      <TokenBalanceRefreshChip
        balance={100}
        symbol="XLM"
        onRefresh={vi.fn()}
        lastSyncedAt="2026-01-01T00:00:00.000Z"
      />
    );
    expect(screen.getByLabelText('Refresh balance')).toHaveAttribute('title', expect.stringContaining('Last synced'));
  });
});

// ---------------------------------------------------------------------------
// 3. isRefreshing prop applies spinning class
// ---------------------------------------------------------------------------

describe('TokenBalanceRefreshChip: isRefreshing prop applies spinning class', () => {
  it('applies the spinning class and aria-busy when isRefreshing is true', () => {
    render(<TokenBalanceRefreshChip balance={100} symbol="XLM" onRefresh={vi.fn()} isRefreshing />);
    const button = screen.getByLabelText('Refresh balance');
    expect(button).toHaveClass('token-balance-chip-refresh--spinning');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
  });

  it('does not apply the spinning class when isRefreshing is false', () => {
    render(<TokenBalanceRefreshChip balance={100} symbol="XLM" onRefresh={vi.fn()} isRefreshing={false} />);
    const button = screen.getByLabelText('Refresh balance');
    expect(button).not.toHaveClass('token-balance-chip-refresh--spinning');
    expect(button).toHaveAttribute('aria-busy', 'false');
  });
});

// ---------------------------------------------------------------------------
// pulse-on-increase
// ---------------------------------------------------------------------------

describe('TokenBalanceRefreshChip: pulse glow on balance increase', () => {
  it('applies the pulse class when the balance increases between renders', () => {
    const { rerender } = render(<TokenBalanceRefreshChip balance={100} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-chip')).not.toHaveClass('token-balance-chip--pulse');

    rerender(<TokenBalanceRefreshChip balance={150} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-chip')).toHaveClass('token-balance-chip--pulse');
  });

  it('does not pulse when the balance decreases', () => {
    const { rerender } = render(<TokenBalanceRefreshChip balance={100} symbol="XLM" />);
    rerender(<TokenBalanceRefreshChip balance={50} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-chip')).not.toHaveClass('token-balance-chip--pulse');
  });

  it('does not pulse when the balance is unchanged', () => {
    const { rerender } = render(<TokenBalanceRefreshChip balance={100} symbol="XLM" />);
    rerender(<TokenBalanceRefreshChip balance={100} symbol="XLM" />);
    expect(screen.getByTestId('token-balance-chip')).not.toHaveClass('token-balance-chip--pulse');
  });
});
