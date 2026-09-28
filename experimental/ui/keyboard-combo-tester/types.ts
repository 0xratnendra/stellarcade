export interface KeyboardComboTrainerProps {
  /** The exact key sequence to match, in order (e.g. KeyboardEvent.key values
   * like 'ArrowUp', 'ArrowDown', 'a'). */
  targetCombo: string[];
  /** Milliseconds allowed between the first keypress and completing (or
   * failing) the combo. Defaults to 2000ms. */
  timeoutMs?: number;
  /** Fired once the full combo is entered correctly, in order. */
  onSuccess: () => void;
  /** Fired when an incorrect key is pressed, or the timeout elapses with an
   * incomplete buffer. */
  onFail?: () => void;
  /** Optional root test id override. */
  testId?: string;
}

export type ComboKeyState = 'pending' | 'entered' | 'current';
