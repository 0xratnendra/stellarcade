/**
 * Arcade theme type definitions for cyberpunk palette variants.
 */

export type ArcadeTheme = 'neon-cyan' | 'synthwave-sunset' | 'matrix-green' | 'high-contrast';

export interface ThemeSwitcherProps {
  /**
   * Currently active arcade theme.
   */
  currentTheme: ArcadeTheme;

  /**
   * Callback fired when theme is changed.
   */
  onChangeTheme: (theme: ArcadeTheme) => void;

  /**
   * Optional compact mode for icon-only layout.
   * Defaults to false.
   */
  compact?: boolean;

  /**
   * Optional additional CSS class names.
   */
  className?: string;

  /**
   * Optional custom test ID for component testing.
   */
  testId?: string;
}

export interface ThemeConfig {
  /**
   * Display name for the theme.
   */
  name: string;

  /**
   * Primary accent color for the theme.
   */
  color: string;

  /**
   * Secondary/background color for contrast.
   */
  bgColor: string;

  /**
   * Text color for readability.
   */
  textColor: string;

  /**
   * Icon emoji/symbol for the theme.
   */
  icon: string;

  /**
   * CSS variables to apply for this theme.
   */
  cssVars: Record<string, string>;
}

export const THEME_CONFIGS: Record<ArcadeTheme, ThemeConfig> = {
  'neon-cyan': {
    name: 'Neon Cyan',
    color: '#00D9FF',
    bgColor: '#0A0E27',
    textColor: '#00D9FF',
    icon: '💎',
    cssVars: {
      '--theme-primary': '#00D9FF',
      '--theme-secondary': '#0A0E27',
      '--theme-accent': '#00FFFF',
      '--theme-text': '#FFFFFF',
      '--theme-bg': '#0A0E27',
    },
  },
  'synthwave-sunset': {
    name: 'Synthwave Sunset',
    color: '#FF006E',
    bgColor: '#1A0033',
    textColor: '#FFB700',
    icon: '🌅',
    cssVars: {
      '--theme-primary': '#FF006E',
      '--theme-secondary': '#FB5607',
      '--theme-accent': '#FFB700',
      '--theme-text': '#FFFFFF',
      '--theme-bg': '#1A0033',
    },
  },
  'matrix-green': {
    name: 'Matrix Green',
    color: '#00FF00',
    bgColor: '#001000',
    textColor: '#00FF00',
    icon: '🔢',
    cssVars: {
      '--theme-primary': '#00FF00',
      '--theme-secondary': '#001000',
      '--theme-accent': '#00DD00',
      '--theme-text': '#00FF00',
      '--theme-bg': '#001000',
    },
  },
  'high-contrast': {
    name: 'High Contrast',
    color: '#FFFF00',
    bgColor: '#000000',
    textColor: '#000000',
    icon: '♿',
    cssVars: {
      '--theme-primary': '#FFFF00',
      '--theme-secondary': '#000000',
      '--theme-accent': '#FFFF00',
      '--theme-text': '#000000',
      '--theme-bg': '#000000',
    },
  },
};
