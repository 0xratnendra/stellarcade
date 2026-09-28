import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { KeyboardComboTrainer, isTypingTarget } from './KeyboardComboTrainer';

const COMBO = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown'];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pressKeys(keys: string[]) {
  for (const key of keys) {
    fireEvent.keyDown(window, { key });
  }
}

describe('isTypingTarget', () => {
  it('is true for an input element', () => {
    const input = document.createElement('input');
    expect(isTypingTarget(input)).toBe(true);
  });

  it('is true for a textarea element', () => {
    const textarea = document.createElement('textarea');
    expect(isTypingTarget(textarea)).toBe(true);
  });

  it('is true for a contenteditable element', () => {
    // jsdom does not implement contentEditable property/attribute
    // reflection (a known gap), so the attribute is set directly here to
    // exercise the same path a real browser's isContentEditable covers.
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(div)).toBe(true);
  });

  it('is false for a plain div', () => {
    const div = document.createElement('div');
    expect(isTypingTarget(div)).toBe(false);
  });

  it('is false for a non-element target', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('KeyboardComboTrainer', () => {
  it('typing the exact sequence triggers onSuccess', () => {
    const onSuccess = vi.fn();
    render(<KeyboardComboTrainer targetCombo={COMBO} onSuccess={onSuccess} />);

    pressKeys(COMBO);

    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('a wrong key triggers onFail and resets the buffer', () => {
    const onSuccess = vi.fn();
    const onFail = vi.fn();
    render(<KeyboardComboTrainer targetCombo={COMBO} onSuccess={onSuccess} onFail={onFail} />);

    pressKeys(['ArrowUp', 'ArrowLeft']); // second key is wrong

    expect(onFail).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();

    // Buffer reset: entering the full correct combo afterward still succeeds.
    pressKeys(COMBO);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('a timeout resets the entered keys and calls onFail', () => {
    const onSuccess = vi.fn();
    const onFail = vi.fn();
    render(
      <KeyboardComboTrainer
        targetCombo={COMBO}
        timeoutMs={1000}
        onSuccess={onSuccess}
        onFail={onFail}
      />,
    );

    pressKeys(['ArrowUp', 'ArrowUp']); // partial combo

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onFail).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();

    // Buffer reset: a fresh full combo attempt still succeeds.
    pressKeys(COMBO);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not fire onFail from a timeout when the buffer is empty', () => {
    const onFail = vi.fn();
    render(<KeyboardComboTrainer targetCombo={COMBO} timeoutMs={1000} onSuccess={vi.fn()} onFail={onFail} />);

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    expect(onFail).not.toHaveBeenCalled();
  });

  it('ignores keydown events targeting an input element', () => {
    const onSuccess = vi.fn();
    const onFail = vi.fn();
    render(
      <div>
        <input data-testid="text-input" />
        <KeyboardComboTrainer targetCombo={COMBO} onSuccess={onSuccess} onFail={onFail} />
      </div>,
    );

    const input = screen.getByTestId('text-input');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowLeft' });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('cleans up its keydown listener on unmount', () => {
    const onSuccess = vi.fn();
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <KeyboardComboTrainer targetCombo={COMBO} onSuccess={onSuccess} />,
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    // A keypress after unmount must not call onSuccess.
    pressKeys(COMBO);
    expect(onSuccess).not.toHaveBeenCalled();

    removeEventListenerSpy.mockRestore();
  });

  it('renders the target combo as a key strip with per-key state', () => {
    const onSuccess = vi.fn();
    render(<KeyboardComboTrainer targetCombo={COMBO} onSuccess={onSuccess} />);

    expect(screen.getByTestId('keyboard-combo-tester-key-0')).toHaveTextContent('ArrowUp');
    expect(screen.getByTestId('keyboard-combo-tester-key-0')).toHaveClass(
      'keyboard-combo-tester__key--current',
    );

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(screen.getByTestId('keyboard-combo-tester-key-0')).toHaveClass(
      'keyboard-combo-tester__key--entered',
    );
    expect(screen.getByTestId('keyboard-combo-tester-key-1')).toHaveClass(
      'keyboard-combo-tester__key--current',
    );
  });
});
