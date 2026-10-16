'use client';

import React, { useState } from 'react';
import { DISPUTE_REASONS, DisputeEvidence, DisputeEvidenceUploaderProps, DisputeReason } from './types';
import './DisputeEvidenceUploader.css';

/** A transaction hash is valid if it is exactly 64 hexadecimal characters
 * (a standard 32-byte hash rendered as hex), case-insensitive. Exported
 * for direct unit testing independent of rendering. */
export function isValidTransactionHash(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

const EMPTY_FORM = {
  transactionHash: '',
  reason: DISPUTE_REASONS[0] as DisputeReason,
  notes: '',
  honestyConfirmed: false,
};

export function DisputeEvidenceUploader({ isOpen, matchId, onSubmit, onClose }: DisputeEvidenceUploaderProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  function resetForm() {
    setForm(EMPTY_FORM);
    setSubmitting(false);
    setError(null);
    setTouched(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);

    if (!isValidTransactionHash(form.transactionHash)) {
      setError('Transaction hash must be exactly 64 hexadecimal characters.');
      return;
    }
    if (!form.honestyConfirmed) {
      setError('You must confirm your submission is honest before submitting.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const evidence: DisputeEvidence = {
        matchId,
        transactionHash: form.transactionHash,
        reason: form.reason,
        notes: form.notes,
      };
      await onSubmit(evidence);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const hashInvalid = touched && form.transactionHash.length > 0 && !isValidTransactionHash(form.transactionHash);

  return (
    <div className="dispute-uploader-backdrop" data-testid="dispute-uploader-backdrop">
      <form
        className="dispute-uploader-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Submit dispute evidence"
        data-testid="dispute-uploader-drawer"
        onSubmit={handleSubmit}
      >
        <div className="dispute-uploader-header">
          <h2>Submit Dispute Evidence</h2>
          <button type="button" aria-label="Close dispute form" onClick={handleClose}>
            &times;
          </button>
        </div>

        <p className="dispute-uploader-match-id">Match: {matchId}</p>

        <label className="dispute-uploader-field">
          Transaction hash
          <input
            type="text"
            value={form.transactionHash}
            onChange={(e) => setForm((f) => ({ ...f, transactionHash: e.target.value.trim() }))}
            aria-invalid={hashInvalid}
            aria-describedby={hashInvalid ? 'tx-hash-error' : undefined}
            placeholder="64-character hex transaction hash"
          />
          {hashInvalid && (
            <span id="tx-hash-error" className="dispute-uploader-field-error">
              Must be exactly 64 hexadecimal characters.
            </span>
          )}
        </label>

        <label className="dispute-uploader-field">
          Dispute reason
          <select value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as DisputeReason }))}>
            {DISPUTE_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>
        </label>

        <label className="dispute-uploader-field">
          Notes / diagnostic payload
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={4}
            placeholder="Paste logs or additional context here"
          />
        </label>

        <label className="dispute-uploader-checkbox">
          <input
            type="checkbox"
            checked={form.honestyConfirmed}
            onChange={(e) => setForm((f) => ({ ...f, honestyConfirmed: e.target.checked }))}
          />
          I confirm this submission is honest and understand false disputes are subject to arbitration penalties.
        </label>

        {error && (
          <p role="alert" className="dispute-uploader-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} aria-busy={submitting} className="dispute-uploader-submit">
          {submitting ? 'Submitting...' : 'Submit Dispute'}
        </button>
      </form>
    </div>
  );
}
