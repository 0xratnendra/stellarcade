'use client';

import React, { useEffect, useRef, useState } from 'react';
import { TokenBalanceRefreshChipProps } from './types';
import './TokenBalanceRefreshChip.css';

/** Format a numeric balance with comma thousands separators and a fixed
 * number of decimal places. Exported for direct unit testing independent
 * of rendering. */
export function formatBalance(balance: number, precision = 2): string {
  return balance.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function TokenBalanceRefreshChip({
  balance,
  symbol,
  icon,
  isRefreshing = false,
  onRefresh,
  lastSyncedAt,
  precision = 2,
}: TokenBalanceRefreshChipProps) {
  const [pulsing, setPulsing] = useState(false);
  const previousBalance = useRef<number | null | undefined>(balance);

  useEffect(() => {
    const prev = previousBalance.current;
    if (typeof prev === 'number' && typeof balance === 'number' && balance > prev) {
      setPulsing(true);
      const timeout = window.setTimeout(() => setPulsing(false), 900);
      previousBalance.current = balance;
      return () => window.clearTimeout(timeout);
    }
    previousBalance.current = balance;
  }, [balance]);

  const isDisconnected = balance === null || balance === undefined;

  const tooltip = lastSyncedAt ? `Last synced: ${new Date(lastSyncedAt).toLocaleString()}` : 'Refresh balance';

  return (
    <div
      className={`token-balance-chip${pulsing ? ' token-balance-chip--pulse' : ''}${
        isDisconnected ? ' token-balance-chip--disconnected' : ''
      }`}
      data-testid="token-balance-chip"
    >
      {icon && <span className="token-balance-chip-icon">{icon}</span>}

      {isDisconnected ? (
        <span className="token-balance-chip-value" data-testid="token-balance-disconnected">
          Wallet disconnected
        </span>
      ) : (
        <span className="token-balance-chip-value" data-testid="token-balance-value">
          {formatBalance(balance, precision)} <span className="token-balance-chip-symbol">{symbol}</span>
        </span>
      )}

      {onRefresh && (
        <button
          type="button"
          className={`token-balance-chip-refresh${isRefreshing ? ' token-balance-chip-refresh--spinning' : ''}`}
          onClick={() => onRefresh()}
          disabled={isRefreshing || isDisconnected}
          aria-busy={isRefreshing}
          aria-label="Refresh balance"
          title={tooltip}
        >
          <span aria-hidden="true" className="token-balance-chip-refresh-icon">
            &#8635;
          </span>
        </button>
      )}
    </div>
  );
}
