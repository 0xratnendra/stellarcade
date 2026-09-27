'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArcadeKeyboardShortcutsModalProps, ShortcutBinding, ShortcutCategory } from './types';
import './ArcadeKeyboardShortcutsModal.css';

const CATEGORY_ORDER: ShortcutCategory[] = ['Navigation', 'Gameplay', 'Audio & Display'];

/** True if `shortcuts` contains a binding matching the '?' toggle hotkey
 * (either the bare '?' key, or the Shift+/ chord that produces it on a
 * standard US keyboard layout). Exported so the global-listener behavior
 * itself is directly testable without simulating a real keydown event. */
export function isToggleHotkey(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  if (event.key === '?') return true;
  return event.shiftKey && event.key === '/';
}

/** Group shortcuts by category, filtering by `query` (case-insensitive
 * substring match against the action name), and drop any category left
 * with zero matches so an empty section never renders. Exported for
 * direct unit testing of the filter logic, independent of rendering. */
export function filterShortcuts(shortcuts: ShortcutBinding[], query: string): Map<ShortcutCategory, ShortcutBinding[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const grouped = new Map<ShortcutCategory, ShortcutBinding[]>();

  for (const category of CATEGORY_ORDER) {
    const matches = shortcuts.filter(
      (s) => s.category === category && s.action.toLowerCase().includes(normalizedQuery)
    );
    if (matches.length > 0) grouped.set(category, matches);
  }

  return grouped;
}

export function ArcadeKeyboardShortcutsModal({
  isOpen,
  shortcuts,
  onClose,
  onToggle,
  onResetKeybindings,
}: ArcadeKeyboardShortcutsModalProps) {
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // Global toggle hotkey: active regardless of isOpen, since '?' should
  // open the modal from anywhere, not just close it while already open.
  useEffect(() => {
    if (!onToggle) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingElsewhere = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (isTypingElsewhere && target !== searchInputRef.current) return;
      if (isToggleHotkey(event)) {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);

  // Escape-to-close and focus lock, only while open.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement;
    searchInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const grouped = useMemo(() => filterShortcuts(shortcuts, query), [shortcuts, query]);
  const hasAnyResults = grouped.size > 0;

  if (!isOpen) return null;

  return (
    <div className="arcade-shortcuts-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="arcade-shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="arcade-shortcuts-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="arcade-shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button type="button" aria-label="Close keyboard shortcuts" onClick={onClose}>
            &times;
          </button>
        </div>

        <input
          ref={searchInputRef}
          type="text"
          className="arcade-shortcuts-search"
          placeholder="Search shortcuts..."
          aria-label="Search shortcuts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="arcade-shortcuts-body">
          {!hasAnyResults && <p className="arcade-shortcuts-empty">No shortcuts match &quot;{query}&quot;.</p>}
          {CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => (
            <section key={category} className="arcade-shortcuts-section">
              <h3>{category}</h3>
              <ul>
                {grouped.get(category)!.map((shortcut) => (
                  <li key={shortcut.id} className="arcade-shortcuts-row" data-testid={`shortcut-${shortcut.id}`}>
                    <span className="arcade-shortcuts-action">{shortcut.action}</span>
                    <span className="arcade-shortcuts-keys">
                      {shortcut.keys.map((key, index) => (
                        <React.Fragment key={key}>
                          {index > 0 && <span className="arcade-shortcuts-key-sep">+</span>}
                          <kbd>{key}</kbd>
                        </React.Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {onResetKeybindings && (
          <div className="arcade-shortcuts-footer">
            <button type="button" className="arcade-shortcuts-reset" onClick={onResetKeybindings}>
              Reset custom keybindings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
