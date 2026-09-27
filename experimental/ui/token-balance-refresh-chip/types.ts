import type { ReactNode } from 'react';

export interface TokenBalanceRefreshChipProps {
  /** Current balance. `null`/`undefined` renders the disconnected-wallet
   * fallback state instead of a balance. */
  balance: number | null | undefined;
  symbol: string;
  /** Optional icon (e.g. an <img> or inline SVG element) rendered before
   * the symbol. */
  icon?: ReactNode;
  isRefreshing?: boolean;
  onRefresh?: () => Promise<void> | void;
  /** ISO 8601 timestamp of the last successful sync, shown in the refresh
   * button's tooltip. Omit to hide the tooltip's "last synced" line. */
  lastSyncedAt?: string;
  /** Number of decimal places to format `balance` with. Defaults to 2. */
  precision?: number;
}
