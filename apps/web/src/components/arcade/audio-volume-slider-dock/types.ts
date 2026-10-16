export interface AudioVolumeSliderDockProps {
  /**
   * Initial volume level from 0 to 100.
   * Defaults to 75.
   */
  initialVolume?: number;

  /**
   * Whether audio is currently muted.
   * Defaults to false.
   */
  isMuted?: boolean;

  /**
   * Callback fired when volume slider value changes (0 - 100).
   */
  onVolumeChange: (volume: number) => void;

  /**
   * Callback fired when mute/unmute button is clicked.
   */
  onToggleMute: () => void;

  /**
   * LocalStorage key to persist volume preferences safely.
   * Defaults to 'stellarcade_volume_preference'.
   */
  storageKey?: string;

  /**
   * Position orientation for the dock slider ('bottom-right' | 'bottom-left' | 'top-right' | 'top-left').
   * Defaults to 'bottom-right'.
   */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  /**
   * Optional custom CSS class names.
   */
  className?: string;

  /**
   * Optional test ID for root element.
   */
  testId?: string;
}
