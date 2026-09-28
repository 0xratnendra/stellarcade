import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardComboTrainerProps } from './types';
import './KeyboardComboTrainer.css';

const DEFAULT_TIMEOUT_MS = 2000;

/** True when `target` is a form control or editable region a global
 * keydown listener should not intercept keys from (so typing in a search
 * box or form field never gets swallowed as a combo attempt).
 *
 * Checks the `contenteditable` attribute directly rather than relying
 * solely on `isContentEditable`: that property is unimplemented in jsdom
 * (always `undefined`, a known jsdom gap since it requires layout support
 * jsdom doesn't provide), so a real browser is covered by either check but
 * a jsdom test environment needs the attribute check to pass at all. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  return attr === '' || attr === 'true';
}

export const KeyboardComboTrainer: React.FC<KeyboardComboTrainerProps> = ({
  targetCombo,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onSuccess,
  onFail,
  testId = 'keyboard-combo-tester',
}) => {
  const [entered, setEntered] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'success' | 'fail'>('idle');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearComboTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetBuffer = useCallback(() => {
    clearComboTimeout();
    setEntered([]);
  }, [clearComboTimeout]);

  const armTimeout = useCallback(() => {
    clearComboTimeout();
    timeoutRef.current = setTimeout(() => {
      setEntered((current) => {
        if (current.length > 0 && current.length < targetCombo.length) {
          setStatus('fail');
          onFail?.();
        }
        return [];
      });
    }, timeoutMs);
  }, [clearComboTimeout, onFail, targetCombo.length, timeoutMs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      setEntered((current) => {
        const nextIndex = current.length;
        const expectedKey = targetCombo[nextIndex];

        if (event.key !== expectedKey) {
          setStatus('fail');
          onFail?.();
          clearComboTimeout();
          return [];
        }

        const next = [...current, event.key];
        if (next.length === targetCombo.length) {
          setStatus('success');
          onSuccess();
          clearComboTimeout();
          return [];
        }

        armTimeout();
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearComboTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCombo, onSuccess, onFail, armTimeout, clearComboTimeout]);

  // Clears the transient success/fail flash after a short delay so a new
  // attempt can start with a neutral visual state.
  useEffect(() => {
    if (status === 'idle') return;
    const flash = setTimeout(() => setStatus('idle'), 600);
    return () => clearTimeout(flash);
  }, [status]);

  return (
    <div
      className={`keyboard-combo-tester keyboard-combo-tester--${status}`}
      data-testid={testId}
    >
      <div className="keyboard-combo-tester__strip" data-testid={`${testId}-strip`}>
        {targetCombo.map((key, index) => {
          const state = index < entered.length ? 'entered' : index === entered.length ? 'current' : 'pending';
          return (
            <span
              key={index}
              className={`keyboard-combo-tester__key keyboard-combo-tester__key--${state}`}
              data-testid={`${testId}-key-${index}`}
            >
              {key}
            </span>
          );
        })}
      </div>
      <div className="keyboard-combo-tester__status" data-testid={`${testId}-status`} aria-live="polite">
        {status === 'success' ? 'Combo!' : status === 'fail' ? 'Missed' : ''}
      </div>
    </div>
  );
};

KeyboardComboTrainer.displayName = 'KeyboardComboTrainer';
export default KeyboardComboTrainer;
