import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { DisputeEvidenceUploader, isValidTransactionHash } from './DisputeEvidenceUploader';

afterEach(cleanup);

const VALID_HASH = 'a'.repeat(64);
const MATCH_ID = 'match-123';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Transaction hash/), { target: { value: VALID_HASH } });
  fireEvent.click(screen.getByLabelText(/I confirm this submission is honest/));
}

// ---------------------------------------------------------------------------
// 1. form validation blocks invalid tx hash
// ---------------------------------------------------------------------------

describe('isValidTransactionHash', () => {
  it('accepts exactly 64 lowercase hex characters', () => {
    expect(isValidTransactionHash('a'.repeat(64))).toBe(true);
  });

  it('accepts uppercase hex characters', () => {
    expect(isValidTransactionHash('A'.repeat(64))).toBe(true);
  });

  it('rejects a hash shorter than 64 characters', () => {
    expect(isValidTransactionHash('a'.repeat(63))).toBe(false);
  });

  it('rejects a hash longer than 64 characters', () => {
    expect(isValidTransactionHash('a'.repeat(65))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidTransactionHash('g'.repeat(64))).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidTransactionHash('')).toBe(false);
  });
});

describe('DisputeEvidenceUploader: form validation blocks invalid tx hash', () => {
  it('shows a validation error and does not call onSubmit for an invalid hash', async () => {
    const onSubmit = vi.fn();
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Transaction hash/), { target: { value: 'not-a-hash' } });
    fireEvent.click(screen.getByLabelText(/I confirm this submission is honest/));
    fireEvent.click(screen.getByText('Submit Dispute'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/64 hexadecimal characters/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('requires the honesty checkbox before allowing submission', async () => {
    const onSubmit = vi.fn();
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Transaction hash/), { target: { value: VALID_HASH } });
    fireEvent.click(screen.getByText('Submit Dispute'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/confirm your submission is honest/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. successful submission calls onSubmit callback
// ---------------------------------------------------------------------------

describe('DisputeEvidenceUploader: successful submission calls onSubmit callback', () => {
  it('calls onSubmit with the assembled evidence when the form is valid', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fillValidForm();
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'saw a desync at block 42' } });
    fireEvent.click(screen.getByText('Submit Dispute'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      matchId: MATCH_ID,
      transactionHash: VALID_HASH,
      reason: 'Oracle Desync',
      notes: 'saw a desync at block 42',
    });
  });

  it('shows a loading state while onSubmit is pending', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fillValidForm();
    fireEvent.click(screen.getByText('Submit Dispute'));

    const button = await screen.findByText('Submitting...');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');

    resolveSubmit();
    await waitFor(() => expect(screen.getByText('Submit Dispute')).toBeInTheDocument());
  });

  it('shows an error and re-enables the form if onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('network error'));
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fillValidForm();
    fireEvent.click(screen.getByText('Submit Dispute'));

    expect(await screen.findByRole('alert')).toHaveTextContent('network error');
    expect(screen.getByText('Submit Dispute')).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 3. close button resets form state
// ---------------------------------------------------------------------------

describe('DisputeEvidenceUploader: close button resets form state', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close dispute form'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the form fields after closing and reopening', () => {
    const { rerender } = render(
      <DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText(/Transaction hash/), { target: { value: VALID_HASH } });
    fireEvent.click(screen.getByLabelText('Close dispute form'));

    rerender(<DisputeEvidenceUploader isOpen={false} matchId={MATCH_ID} onSubmit={vi.fn()} onClose={vi.fn()} />);
    rerender(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/Transaction hash/)).toHaveValue('');
  });

  it('resets the form after a successful submission', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<DisputeEvidenceUploader isOpen matchId={MATCH_ID} onSubmit={onSubmit} onClose={vi.fn()} />);

    fillValidForm();
    fireEvent.click(screen.getByText('Submit Dispute'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByLabelText(/Transaction hash/)).toHaveValue('');
  });

  it('does not render anything when isOpen is false', () => {
    render(<DisputeEvidenceUploader isOpen={false} matchId={MATCH_ID} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('dispute-uploader-drawer')).not.toBeInTheDocument();
  });
});
