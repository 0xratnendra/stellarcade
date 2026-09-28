# Keyboard Combo Tester

A fighting-game style key combo trainer: listens for keydown events in sequence, shows a visual
key strip (required vs. entered keys), and flashes a success glow or failure shake.

> **Status:** experimental, self-contained component under `experimental/ui/`.

## Usage

```tsx
import { KeyboardComboTrainer } from './keyboard-combo-tester/KeyboardComboTrainer';

function ComboChallenge() {
  return (
    <KeyboardComboTrainer
      targetCombo={['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight']}
      timeoutMs={2000}
      onSuccess={() => console.log('Combo complete!')}
      onFail={() => console.log('Combo failed')}
    />
  );
}
```

## Props

| Prop | Type | Description |
|---|---|---|
| `targetCombo` | `string[]` | The exact `KeyboardEvent.key` sequence to match, in order. |
| `timeoutMs` | `number?` | Milliseconds allowed between keypresses before the buffer resets. Defaults to 2000ms. |
| `onSuccess` | `() => void` | Fired once the full combo is entered correctly. |
| `onFail` | `() => void?` | Fired on a wrong key, or a timeout with an incomplete buffer. |
| `testId` | `string?` | Optional root test id override. |

## Features

- Global `keydown` listener, cleaned up on unmount.
- Visual key strip: pending (gray), current (blue), entered (green).
- Success glow animation on combo completion; failure shake on a wrong key.
- Ignores keydown events targeting an `<input>`, `<textarea>`, or any `contenteditable` element,
  so typing in a form field never gets intercepted as a combo attempt.
- Wrong key or timeout both reset the buffer, so a new attempt always starts clean.

## Testing

```bash
cd experimental/ui/keyboard-combo-tester
npm install
npm test
```

Covers: a correct full sequence firing `onSuccess`, a wrong key firing `onFail` and resetting the
buffer (with a subsequent correct attempt still succeeding), a timeout resetting the buffer and
firing `onFail`, a timeout with an empty buffer *not* firing `onFail`, keydown events inside a
text input being ignored entirely, listener cleanup on unmount, and per-key visual state
rendering.
