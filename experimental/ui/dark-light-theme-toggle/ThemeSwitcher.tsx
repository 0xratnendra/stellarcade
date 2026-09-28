/**
 * Arcade-themed segmented theme switcher dock component.
 * Supports multiple cyberpunk palette variants with keyboard navigation.
 */

import React, { useRef } from 'react';
import type { ArcadeTheme, ThemeSwitcherProps } from './types';
import { THEME_CONFIGS } from './types';

const THEME_OPTIONS: ArcadeTheme[] = ['neon-cyan', 'synthwave-sunset', 'matrix-green', 'high-contrast'];

export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({
  currentTheme,
  onChangeTheme,
  compact = false,
  className = '',
  testId = 'theme-switcher',
}) => {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let targetIndex = -1;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      targetIndex = (index + 1) % THEME_OPTIONS.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      targetIndex = (index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = THEME_OPTIONS.length - 1;
    }

    if (targetIndex !== -1) {
      buttonRefs.current[targetIndex]?.focus();
      onChangeTheme(THEME_OPTIONS[targetIndex]);
    }
  };

  const handleThemeClick = (theme: ArcadeTheme) => {
    onChangeTheme(theme);
  };

  return (
    <div
      data-testid={testId}
      role="radiogroup"
      aria-label="Arcade theme selector"
      className={`theme-switcher-dock ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? '8px' : '12px',
        padding: compact ? '8px 12px' : '12px 16px',
        backgroundColor: 'rgba(10, 14, 39, 0.8)',
        borderRadius: '9999px',
        border: '2px solid',
        borderColor: THEME_CONFIGS[currentTheme].color,
        boxShadow: `0 0 20px ${THEME_CONFIGS[currentTheme].color}40, inset 0 2px 4px rgba(0, 0, 0, 0.6)`,
        backdropFilter: 'blur(10px)',
        transition: 'all 0.3s ease-out',
      }}
    >
      {THEME_OPTIONS.map((theme, index) => {
        const config = THEME_CONFIGS[theme];
        const isSelected = currentTheme === theme;

        return (
          <button
            key={theme}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${config.name} theme`}
            data-testid={`theme-button-${theme}`}
            data-theme={theme}
            onClick={() => handleThemeClick(theme)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            tabIndex={isSelected ? 0 : -1}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: compact ? '0' : '6px',
              padding: compact ? '8px' : '8px 12px',
              backgroundColor: isSelected ? `${config.color}20` : 'transparent',
              border: `2px solid ${isSelected ? config.color : 'rgba(255, 255, 255, 0.2)'}`,
              borderRadius: '8px',
              color: config.color,
              cursor: 'pointer',
              fontSize: compact ? '14px' : '13px',
              fontWeight: 600,
              fontFamily: 'monospace, sans-serif',
              transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              outline: 'none',
              boxShadow: isSelected
                ? `0 0 12px ${config.color}60, inset 0 1px 2px rgba(255, 255, 255, 0.1)`
                : '0 2px 4px rgba(0, 0, 0, 0.2)',
              transform: isSelected ? 'scale(1.05)' : 'scale(1)',
              userSelect: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {/* Color dot preview */}
            <div
              aria-hidden="true"
              style={{
                width: compact ? '8px' : '10px',
                height: compact ? '8px' : '10px',
                borderRadius: '50%',
                backgroundColor: config.color,
                boxShadow: `0 0 6px ${config.color}80`,
                flexShrink: 0,
              }}
            />

            {/* Theme icon and label */}
            {!compact && (
              <>
                <span style={{ fontSize: '16px', lineHeight: 1 }}>{config.icon}</span>
                <span>{config.name}</span>
              </>
            )}
            {compact && <span style={{ fontSize: '14px', lineHeight: 1 }}>{config.icon}</span>}
          </button>
        );
      })}
    </div>
  );
};
