export type ChipColorTheme = 'white' | 'red' | 'green' | 'black' | 'purple' | 'custom';

export type SoundEffectType = 'select' | 'increment' | 'disabled';

export interface QuickWagerChipSelectorProps {
  /**
   * Array of available chip values in XLM.
   * Defaults to [1, 5, 25, 100, 500].
   */
  availableChips?: number[];

  /**
   * Currently selected wager amount.
   */
  selectedAmount: number;

  /**
   * Player's available balance in XLM.
   * Chips exceeding this balance are disabled.
   */
  userBalance: number;

  /**
   * Callback fired when a chip is selected or incremented.
   */
  onSelectChip: (value: number) => void;

  /**
   * Optional callback triggered when a sound effect should play.
   */
  onPlaySound?: (soundType: SoundEffectType) => void;

  /**
   * Optional additional CSS class names.
   */
  className?: string;

  /**
   * Optional custom test ID for component testing.
   */
  testId?: string;
}
