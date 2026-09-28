import React, { useCallback, useMemo, useState } from 'react';
import type { CurrencyConversionTagProps, FiatCurrency } from './types';
import { FIAT_CURRENCIES, FIAT_SYMBOLS } from './types';
import './CurrencyConversionTag.css';

export type FreshnessLevel = 'fresh' | 'stale' | 'very-stale' | 'unknown';

const FRESH_THRESHOLD_MS = 60_000; // 1 minute
const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

/** Converts a possibly-string XLM amount to a finite number, or null for
 * anything unparseable (never NaN/Infinity, so callers never need to guard
 * a math result themselves). */
export function parseXlmAmount(xlmAmount: number | string): number | null {
  const value = typeof xlmAmount === 'string' ? parseFloat(xlmAmount) : xlmAmount;
  return Number.isFinite(value) ? value : null;
}

/** Converts an XLM amount to its fiat equivalent using `rates`. Returns 0
 * for a non-positive or unparseable amount, or a missing rate — never NaN,
 * so a zero or negative amount always renders safely instead of throwing. */
export function convertToFiat(
  xlmAmount: number | string,
  currency: FiatCurrency,
  rates: Record<string, number>,
): number {
  const amount = parseXlmAmount(xlmAmount);
  const rate = rates[currency];
  if (amount === null || amount <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return 0;
  }
  return amount * rate;
}

/** Classifies how recently `lastUpdatedAt` was, for the freshness dot. */
export function getFreshnessLevel(
  lastUpdatedAt: number | undefined,
  now: number = Date.now(),
): FreshnessLevel {
  if (lastUpdatedAt === undefined) return 'unknown';
  const age = now - lastUpdatedAt;
  if (age < 0) return 'fresh';
  if (age <= FRESH_THRESHOLD_MS) return 'fresh';
  if (age <= STALE_THRESHOLD_MS) return 'stale';
  return 'very-stale';
}

export const CurrencyConversionTag: React.FC<CurrencyConversionTagProps> = ({
  xlmAmount,
  selectedFiat: selectedFiatProp,
  rates,
  onSelectFiat,
  lastUpdatedAt,
  precision = 2,
  testId = 'currency-conversion-tag',
}) => {
  const [internalFiat, setInternalFiat] = useState<FiatCurrency>(selectedFiatProp ?? 'USD');
  const [tooltipOpen, setTooltipOpen] = useState(false);

  // Supports both controlled (selectedFiat + onSelectFiat) and
  // uncontrolled usage: when no selectedFiat prop is given, the tag tracks
  // its own selection internally.
  const selectedFiat = selectedFiatProp ?? internalFiat;

  const amountDisplay = useMemo(() => {
    const parsed = parseXlmAmount(xlmAmount);
    return parsed === null ? '0' : parsed.toString();
  }, [xlmAmount]);

  const fiatValue = useMemo(
    () => convertToFiat(xlmAmount, selectedFiat, rates),
    [xlmAmount, selectedFiat, rates],
  );

  const freshness = useMemo(() => getFreshnessLevel(lastUpdatedAt), [lastUpdatedAt]);

  const handleSelect = useCallback(
    (currency: FiatCurrency) => {
      if (selectedFiatProp === undefined) {
        setInternalFiat(currency);
      }
      onSelectFiat?.(currency);
      setTooltipOpen(false);
    },
    [selectedFiatProp, onSelectFiat],
  );

  return (
    <span className="currency-conversion-tag" data-testid={testId}>
      <button
        type="button"
        className="currency-conversion-tag__badge"
        onClick={() => setTooltipOpen((open) => !open)}
        data-testid={`${testId}-badge`}
        aria-expanded={tooltipOpen}
      >
        <span
          className={`currency-conversion-tag__freshness-dot currency-conversion-tag__freshness-dot--${freshness}`}
          data-testid={`${testId}-freshness-dot`}
          aria-label={`Rate freshness: ${freshness}`}
        />
        <span data-testid={`${testId}-xlm-amount`}>{amountDisplay} XLM</span>
        <span className="currency-conversion-tag__fiat" data-testid={`${testId}-fiat-value`}>
          (~{FIAT_SYMBOLS[selectedFiat]}
          {fiatValue.toFixed(precision)} {selectedFiat})
        </span>
      </button>

      {tooltipOpen && (
        <div className="currency-conversion-tag__tooltip" data-testid={`${testId}-tooltip`} role="menu">
          {FIAT_CURRENCIES.map((currency) => (
            <button
              key={currency}
              type="button"
              role="menuitem"
              className={`currency-conversion-tag__tooltip-item ${
                currency === selectedFiat ? 'currency-conversion-tag__tooltip-item--active' : ''
              }`}
              onClick={() => handleSelect(currency)}
              data-testid={`${testId}-select-${currency}`}
            >
              {FIAT_SYMBOLS[currency]} {currency}
            </button>
          ))}
        </div>
      )}
    </span>
  );
};

CurrencyConversionTag.displayName = 'CurrencyConversionTag';
export default CurrencyConversionTag;
