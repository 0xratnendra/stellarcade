# Arcade Keyboard Shortcuts Modal

An accessible keyboard shortcuts cheat sheet modal for power users
navigating Stellarcade games via hotkeys: styled `<kbd>` keycaps, shortcuts
grouped into Navigation / Gameplay / Audio & Display sections, a live
search filter, and an optional global `?` (or `Shift+/`) toggle hotkey.

> **Status:** experimental, self-contained component under
> `experimental/ui/`. It does not modify `apps/web`'s app shell.

## Props

See `types.ts` for `ArcadeKeyboardShortcutsModalProps`:

- `isOpen`, `shortcuts`, `onClose`: the modal's core, required contract.
- `onToggle` (optional): called whenever the global `?` / `Shift+/` hotkey
  fires, whether the modal is currently open or closed. The parent owns
  `isOpen` state and decides how to react (typically flipping it); omit
  this prop entirely to disable the global listener.
- `onResetKeybindings` (optional): called when "Reset custom keybindings"
  is activated. The reset control only renders when this prop is provided,
  since without it there is nothing for the control to do.

## Accessibility

- `role="dialog"` + `aria-modal="true"` + `aria-label="Keyboard shortcuts"`.
- Focus moves to the search input on open, and returns to whatever was
  focused before the modal opened, on close.
- Tab/Shift+Tab is trapped within the dialog while open (a rudimentary
  focus lock: cycles between the first and last focusable element).
- Escape closes the modal; clicking the backdrop closes it; clicking
  inside the dialog does not.

## Search behavior

Filtering is case-insensitive substring matching against each shortcut's
`action` name. A category with zero matches for the current query is
omitted entirely rather than rendered empty, and an explicit "No shortcuts
match" message appears when every category is empty.

## Installation

```bash
cd experimental/ui/arcade-keyboard-shortcuts-modal
npm install
```

## Testing

```bash
npm test
```

This component has its own `package.json`/`vitest.config.ts` (matching
`experimental/ui/streak-chest-unboxing`'s pattern) so `npm test` works
standalone from within this directory. A sibling component's README
claiming a shared root-level `vitest` invocation works was verified
inaccurate while building this one (no root `vitest` binary or shared
`@testing-library/jest-dom` install exists), so this README does not
repeat that instruction.
