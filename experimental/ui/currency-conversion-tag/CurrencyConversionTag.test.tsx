import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  CurrencyConversionTag,
  convertToFiat,
  getFreshnessLevel,
  parseXlmAmount,
} from './CurrencyConversionTag';

afterEach(cleanup);

const RATES = { USD: 0.125, EUR: 0.115, GBP: 0.098 };

describe('convertToFiat', () => {
  it('matches the rate multiplication for a positive amount', () => {
    expect(convertToFiat(100, 'USD', RATES)).toBeCloseTo(12.5, 5);
  });

  it('handles a string amount the same as a number', () => {
    expect(convertToFiat('100', 'USD', RATES)).toBeCloseTo(12.5, 5);
  });

  it('returns 0 for a zero amount without throwing', () => {
    expect(convertToFiat(0, 'USD', RATES)).toBe(0);
  });

  it('returns 0 for a negative amount without throwing', () => {
    expect(convertToFiat(-50, 'USD', RATES)).toBe(0);
  });

  it('returns 0 for an unparseable amount', () => {
    expect(convertToFiat('not-a-number', 'USD', RATES)).toBe(0);
  });

  it('returns 0 when the rate for the currency is missing', () => {
    expect(convertToFiat(100, 'GBP', {})).toBe(0);
  });
});

describe('parseXlmAmount', () => {
  it('parses a numeric string', () => {
    expect(parseXlmAmount('42.5')).toBe(42.5);
  });

  it('returns null for garbage input', () => {
    expect(parseXlmAmount('abc')).toBeNull();
  });
});

describe('getFreshnessLevel', () => {
  const now = 1_000_000;

  it('is fresh within the fresh threshold', () => {
    expect(getFreshnessLevel(now - 10_000, now)).toBe('fresh');
  });

  it('is stale between the fresh and stale thresholds', () => {
    expect(getFreshnessLevel(now - 2 * 60_000, now)).toBe('stale');
  });

  it('is very-stale past the stale threshold', () => {
    expect(getFreshnessLevel(now - 10 * 60_000, now)).toBe('very-stale');
  });

  it('is unknown when no timestamp is given', () => {
    expect(getFreshnessLevel(undefined, now)).toBe('unknown');
  });
});

describe('CurrencyConversionTag', () => {
  it('displays the XLM amount and its fiat equivalent', () => {
    render(<CurrencyConversionTag xlmAmount={100} selectedFiat="USD" rates={RATES} />);

    expect(screen.getByTestId('currency-conversion-tag-xlm-amount')).toHaveTextContent('100 XLM');
    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('$12.50 USD');
  });

  it('switches fiat currency and updates the displayed symbol and value', () => {
    const onSelectFiat = vi.fn();
    render(
      <CurrencyConversionTag
        xlmAmount={100}
        selectedFiat="USD"
        rates={RATES}
        onSelectFiat={onSelectFiat}
      />,
    );

    fireEvent.click(screen.getByTestId('currency-conversion-tag-badge'));
    fireEvent.click(screen.getByTestId('currency-conversion-tag-select-EUR'));

    expect(onSelectFiat).toHaveBeenCalledWith('EUR');
  });

  it('updates its own displayed value when used uncontrolled (no selectedFiat prop)', () => {
    render(<CurrencyConversionTag xlmAmount={100} rates={RATES} />);

    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('USD');

    fireEvent.click(screen.getByTestId('currency-conversion-tag-badge'));
    fireEvent.click(screen.getByTestId('currency-conversion-tag-select-GBP'));

    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('GBP');
    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('£9.80');
  });

  it('handles a zero amount without throwing and renders a zero value', () => {
    render(<CurrencyConversionTag xlmAmount={0} rates={RATES} />);

    expect(screen.getByTestId('currency-conversion-tag-xlm-amount')).toHaveTextContent('0 XLM');
    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('$0.00');
  });

  it('handles a negative amount without throwing', () => {
    render(<CurrencyConversionTag xlmAmount={-25} rates={RATES} />);
    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('$0.00');
  });

  it('respects a custom precision prop', () => {
    render(<CurrencyConversionTag xlmAmount={100} rates={RATES} precision={4} />);
    expect(screen.getByTestId('currency-conversion-tag-fiat-value')).toHaveTextContent('$12.5000');
  });

  it('shows a fresh dot for a recent rate update', () => {
    render(
      <CurrencyConversionTag xlmAmount={100} rates={RATES} lastUpdatedAt={Date.now() - 1000} />,
    );
    expect(screen.getByTestId('currency-conversion-tag-freshness-dot')).toHaveClass(
      'currency-conversion-tag__freshness-dot--fresh',
    );
  });

  it('shows a very-stale dot for an old rate update', () => {
    render(
      <CurrencyConversionTag
        xlmAmount={100}
        rates={RATES}
        lastUpdatedAt={Date.now() - 60 * 60_000}
      />,
    );
    expect(screen.getByTestId('currency-conversion-tag-freshness-dot')).toHaveClass(
      'currency-conversion-tag__freshness-dot--very-stale',
    );
  });
});
