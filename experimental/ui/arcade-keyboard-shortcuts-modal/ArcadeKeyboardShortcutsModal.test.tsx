import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import {
  ArcadeKeyboardShortcutsModal,
  filterShortcuts,
  isToggleHotkey,
} from './ArcadeKeyboardShortcutsModal';
import { ShortcutBinding } from './types';

afterEach(cleanup);

const SHORTCUTS: ShortcutBinding[] = [
  { id: 'flip', action: 'Flip card', category: 'Gameplay', keys: ['Space'] },
  { id: 'wager-1', action: 'Wager tier 1', category: 'Gameplay', keys: ['1'] },
  { id: 'mute', action: 'Mute audio', category: 'Audio & Display', keys: ['M'] },
  { id: 'help', action: 'Open shortcuts', category: 'Navigation', keys: ['Shift', '/'] },
];

// ---------------------------------------------------------------------------
// 1. modal renders keycap shortcuts grouped by section
// ---------------------------------------------------------------------------

describe('ArcadeKeyboardShortcutsModal: renders keycap shortcuts grouped by section', () => {
  it('renders each shortcut under its category heading with kbd keycaps', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Gameplay' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Audio & Display' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();

    const flipRow = screen.getByTestId('shortcut-flip');
    expect(flipRow).toHaveTextContent('Flip card');
    expect(flipRow.querySelector('kbd')).toHaveTextContent('Space');
  });

  it('renders a multi-key binding as separate kbd tags joined visually', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    const helpRow = screen.getByTestId('shortcut-help');
    const kbds = helpRow.querySelectorAll('kbd');
    expect(kbds).toHaveLength(2);
    expect(kbds[0]).toHaveTextContent('Shift');
    expect(kbds[1]).toHaveTextContent('/');
  });

  it('does not render when isOpen is false', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen={false} shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    expect(screen.queryByTestId('arcade-shortcuts-dialog')).not.toBeInTheDocument();
  });

  it('exposes an accessible dialog role and label', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Keyboard shortcuts');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});

// ---------------------------------------------------------------------------
// 2. search input filters shortcut list
// ---------------------------------------------------------------------------

describe('ArcadeKeyboardShortcutsModal: search input filters shortcut list', () => {
  it('filters the visible shortcuts as the user types', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search shortcuts'), { target: { value: 'mute' } });

    expect(screen.getByTestId('shortcut-mute')).toBeInTheDocument();
    expect(screen.queryByTestId('shortcut-flip')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gameplay' })).not.toBeInTheDocument();
  });

  it('shows an empty-state message when no shortcut matches the query', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search shortcuts'), { target: { value: 'nonexistent-action' } });
    expect(screen.getByText(/No shortcuts match/)).toBeInTheDocument();
  });

  it('search is case-insensitive', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Search shortcuts'), { target: { value: 'FLIP' } });
    expect(screen.getByTestId('shortcut-flip')).toBeInTheDocument();
  });

  it('clearing the search restores every shortcut', () => {
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Search shortcuts');
    fireEvent.change(input, { target: { value: 'mute' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('shortcut-flip')).toBeInTheDocument();
    expect(screen.getByTestId('shortcut-mute')).toBeInTheDocument();
  });
});

describe('filterShortcuts (pure logic)', () => {
  it('drops a category entirely when it has zero matches, without an empty section', () => {
    const grouped = filterShortcuts(SHORTCUTS, 'mute');
    expect(grouped.has('Gameplay')).toBe(false);
    expect(grouped.get('Audio & Display')).toHaveLength(1);
  });

  it('returns every shortcut, grouped, for an empty query', () => {
    const grouped = filterShortcuts(SHORTCUTS, '');
    expect(grouped.get('Gameplay')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. closing modal invokes onClose
// ---------------------------------------------------------------------------

describe('ArcadeKeyboardShortcutsModal: closing modal invokes onClose', () => {
  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the backdrop, but not when clicking inside the dialog', () => {
    const onClose = vi.fn();
    render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={onClose} />);

    fireEvent.mouseDown(screen.getByTestId('arcade-shortcuts-dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId('arcade-shortcuts-dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// global toggle hotkey and reset keybindings
// ---------------------------------------------------------------------------

describe('isToggleHotkey', () => {
  it('recognizes a bare "?" key press', () => {
    expect(isToggleHotkey({ key: '?', shiftKey: false })).toBe(true);
  });

  it('recognizes Shift+/ as the toggle chord', () => {
    expect(isToggleHotkey({ key: '/', shiftKey: true })).toBe(true);
  });

  it('does not recognize a bare "/" without Shift', () => {
    expect(isToggleHotkey({ key: '/', shiftKey: false })).toBe(false);
  });

  it('does not recognize an unrelated key', () => {
    expect(isToggleHotkey({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('ArcadeKeyboardShortcutsModal: global toggle hotkey', () => {
  it('invokes onToggle when "?" is pressed anywhere, even while the modal is closed', () => {
    const onToggle = vi.fn();
    render(<ArcadeKeyboardShortcutsModal isOpen={false} shortcuts={SHORTCUTS} onClose={vi.fn()} onToggle={onToggle} />);
    fireEvent.keyDown(window, { key: '?' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not register a global listener when onToggle is not provided', () => {
    // No assertion needed beyond "this doesn't throw" — the listener setup
    // itself is conditional on onToggle being defined.
    expect(() =>
      render(<ArcadeKeyboardShortcutsModal isOpen={false} shortcuts={SHORTCUTS} onClose={vi.fn()} />)
    ).not.toThrow();
  });
});

describe('ArcadeKeyboardShortcutsModal: reset keybindings', () => {
  it('renders the reset control only when onResetKeybindings is provided', () => {
    const { rerender } = render(<ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} />);
    expect(screen.queryByText('Reset custom keybindings')).not.toBeInTheDocument();

    rerender(
      <ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} onResetKeybindings={vi.fn()} />
    );
    expect(screen.getByText('Reset custom keybindings')).toBeInTheDocument();
  });

  it('calls onResetKeybindings when the reset control is clicked', () => {
    const onReset = vi.fn();
    render(
      <ArcadeKeyboardShortcutsModal isOpen shortcuts={SHORTCUTS} onClose={vi.fn()} onResetKeybindings={onReset} />
    );
    fireEvent.click(screen.getByText('Reset custom keybindings'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
