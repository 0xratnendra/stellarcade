export type ShortcutCategory = 'Navigation' | 'Gameplay' | 'Audio & Display';

export interface ShortcutBinding {
  id: string;
  /** Human-readable action name, e.g. "Flip card" or "Mute audio". */
  action: string;
  category: ShortcutCategory;
  /** One or more key combinations that trigger this action, e.g.
   * `['Space']` or `['Shift', '/']` (rendered as separate `<kbd>` tags
   * joined by a "+"). */
  keys: string[];
  /** True if the player has remapped this binding away from its default;
   * drives whether "Reset custom keybindings" has any effect on it. */
  isCustomized?: boolean;
}

export interface ArcadeKeyboardShortcutsModalProps {
  isOpen: boolean;
  shortcuts: ShortcutBinding[];
  onClose: () => void;
  /** Called when the modal's own global toggle hotkey ('?' or 'Shift+/')
   * fires while the modal is closed or open; the parent owns `isOpen`
   * state and decides how to react (typically flipping it). Optional: a
   * consumer that doesn't want the global listener simply omits it. */
  onToggle?: () => void;
  /** Called when "Reset custom keybindings" is activated. Optional: if
   * omitted, the reset control is not rendered, since there would be
   * nothing for it to do. */
  onResetKeybindings?: () => void;
}
