# Currency Conversion Tag

An inline badge showing an XLM token amount alongside its fiat equivalent (USD/EUR/GBP), with a
currency-switch tooltip and a rate-freshness indicator.

> **Status:** experimental, self-contained component under `experimental/ui/`. It does not modify
> `apps/web`'s existing currency formatters.

## Usage

```tsx
import { CurrencyConversionTag } from './currency-conversion-tag/CurrencyConversionTag';

function Price() {
  return (
    <CurrencyConversionTag
      xlmAmount={100}
      rates={{ USD: 0.125, EUR: 0.115, GBP: 0.098 }}
      lastUpdatedAt={Date.now()}
      onSelectFiat={(currency) => console.log('switched to', currency)}
    />
  );
}
```

## Props

| Prop | Type | Description |
|---|---|---|
| `xlmAmount` | `number \| string` | XLM amount to convert. |
| `selectedFiat` | `'USD' \| 'EUR' \| 'GBP'?` | Controls the displayed currency. Omit for uncontrolled internal state. |
| `rates` | `Record<string, number>` | XLM-to-fiat conversion rates, keyed by currency code. |
| `onSelectFiat` | `(currency) => void` | Fired when the user picks a currency from the tooltip. |
| `lastUpdatedAt` | `number?` | Unix ms of the last rate fetch, drives the freshness dot. |
| `precision` | `number?` | Decimal places for the fiat value. Defaults to 2. |
| `testId` | `string?` | Optional root test id override. |

## Features

- Inline badge: `100 XLM (~$12.50 USD)`.
- Click-to-open currency tooltip for switching between USD, EUR, and GBP.
- Freshness dot: green (< 1 min), yellow (< 5 min), red (stale), gray (unknown).
- Safe math: a zero, negative, or unparseable amount, or a missing rate, always renders `0`
  rather than `NaN` or throwing.

## Testing

```bash
cd experimental/ui/currency-conversion-tag
npm install
npm test
```

Covers: conversion math matching rate multiplication, currency switching updating both symbol and
value (controlled and uncontrolled usage), zero/negative/unparseable-amount safety, custom
precision, and freshness-dot classification.
