# Dispute Evidence Uploader

A slide-out drawer for submitting dispute evidence on a match: a
transaction hash validator, a dispute reason dropdown, a notes/diagnostic
payload textarea, and an honesty confirmation checkbox before submission.

> **Status:** experimental, self-contained component under
> `experimental/ui/`. It does not modify core `apps/web/` pages.

## Props

See `types.ts` for `DisputeEvidenceUploaderProps`. `onSubmit` receives an
assembled `DisputeEvidence` object (`matchId`, `transactionHash`,
`reason`, `notes`) only after both the transaction hash and the honesty
checkbox validate.

## Validation

- `isValidTransactionHash` (exported for direct testing) requires exactly
  64 hexadecimal characters (a standard 32-byte hash rendered as hex,
  case-insensitive).
- The honesty checkbox must be checked before submission; both this and
  the hash format produce a single top-level error banner
  (`role="alert"`), rather than the field-level indicator ALSO carrying
  its own `role="alert"` and duplicating the same announcement for
  screen reader users.
- A rejected `onSubmit` promise surfaces its error message in the same
  banner and re-enables the form rather than leaving it stuck in a
  loading state.

## Behavior

- Closing the drawer (via the close button) resets all form state, so
  reopening it always starts fresh.
- A successful submission also resets the form.
- The submit button carries `aria-busy` and is disabled while `onSubmit`
  is pending.

## Installation

```bash
cd experimental/ui/dispute-evidence-uploader
npm install
```

## Testing

```bash
npm test
```
