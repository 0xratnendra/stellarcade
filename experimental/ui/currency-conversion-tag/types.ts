export type FiatCurrency = 'USD' | 'EUR' | 'GBP';

export const FIAT_CURRENCIES: FiatCurrency[] = ['USD', 'EUR', 'GBP'];

export const FIAT_SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export interface CurrencyConversionTagProps {
  /** XLM amount to convert. Accepts a string so callers can pass raw
   * on-chain amounts without a float round-trip. */
  xlmAmount: number | string;
  /** Currently selected fiat currency. Defaults to 'USD'. */
  selectedFiat?: FiatCurrency;
  /** XLM-to-fiat conversion rates, keyed by currency code. */
  rates: Record<string, number>;
  /** Fired when the user picks a different currency from the tooltip. */
  onSelectFiat?: (currency: FiatCurrency) => void;
  /** Unix ms timestamp of the last rate fetch, for the freshness dot. */
  lastUpdatedAt?: number;
  /** Decimal places shown for the fiat value. Defaults to 2. */
  precision?: number;
  /** Optional root test id override. */
  testId?: string;
}
