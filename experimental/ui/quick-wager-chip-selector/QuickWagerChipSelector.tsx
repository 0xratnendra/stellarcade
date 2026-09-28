import React, { useRef } from 'react';
import type { QuickWagerChipSelectorProps } from './types';

const DEFAULT_CHIPS = [1, 5, 25, 100, 500];

interface ChipThemeConfig {
  bg: string;
  border: string;
  textColor: string;
  innerRing: string;
  glowColor: string;
}

const getChipTheme = (value: number): ChipThemeConfig => {
  switch (value) {
    case 1:
      return {
        bg: 'linear-gradient(135deg, #F8FAFC 0%, #E2E8F0 100%)',
        border: '#94A3B8',
        textColor: '#0F172A',
        innerRing: 'rgba(15, 23, 42, 0.25)',
        glowColor: 'rgba(226, 232, 240, 0.6)',
      };
    case 5:
      return {
        bg: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
        border: '#7F1D1D',
        textColor: '#FFFFFF',
        innerRing: 'rgba(255, 255, 255, 0.35)',
        glowColor: 'rgba(239, 68, 68, 0.5)',
      };
    case 25:
      return {
        bg: 'linear-gradient(135deg, #22C55E 0%, #15803D 100%)',
        border: '#14532D',
        textColor: '#FFFFFF',
        innerRing: 'rgba(255, 255, 255, 0.35)',
        glowColor: 'rgba(34, 197, 94, 0.5)',
      };
    case 100:
      return {
        bg: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
        border: '#F59E0B',
        textColor: '#FDE047',
        innerRing: 'rgba(245, 158, 11, 0.45)',
        glowColor: 'rgba(245, 158, 11, 0.5)',
      };
    case 500:
      return {
        bg: 'linear-gradient(135deg, #8B5CF6 0%, #5B21B6 100%)',
        border: '#4C1D95',
        textColor: '#FFFFFF',
        innerRing: 'rgba(255, 255, 255, 0.35)',
        glowColor: 'rgba(139, 92, 246, 0.5)',
      };
    default:
      return {
        bg: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
        border: '#1E3A8A',
        textColor: '#FFFFFF',
        innerRing: 'rgba(255, 255, 255, 0.35)',
        glowColor: 'rgba(59, 130, 246, 0.5)',
      };
  }
};

export const QuickWagerChipSelector: React.FC<QuickWagerChipSelectorProps> = ({
  availableChips = DEFAULT_CHIPS,
  selectedAmount,
  userBalance,
  onSelectChip,
  onPlaySound,
  className = '',
  testId = 'quick-wager-chip-selector',
}) => {
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleChipClick = (value: number) => {
    if (value > userBalance) {
      onPlaySound?.('disabled');
      return;
    }
    onPlaySound?.('select');
    onSelectChip(value);
  };

  const handleChipDoubleClick = (value: number) => {
    if (value > userBalance) {
      onPlaySound?.('disabled');
      return;
    }
    const newTotal = selectedAmount + value;
    if (newTotal <= userBalance) {
      onPlaySound?.('increment');
      onSelectChip(newTotal);
    } else {
      onPlaySound?.('disabled');
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const enabledChips = availableChips
      .map((val, idx) => ({ val, idx }))
      .filter((item) => item.val <= userBalance);

    if (enabledChips.length === 0) return;

    let targetIndex = -1;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const currentPos = enabledChips.findIndex((c) => c.idx === currentIndex);
      const nextPos = (currentPos + 1) % enabledChips.length;
      targetIndex = enabledChips[nextPos].idx;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const currentPos = enabledChips.findIndex((c) => c.idx === currentIndex);
      const prevPos =
        (currentPos - 1 + enabledChips.length) % enabledChips.length;
      targetIndex = enabledChips[prevPos].idx;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = enabledChips[0].idx;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = enabledChips[enabledChips.length - 1].idx;
    }

    if (targetIndex !== -1) {
      const targetChip = availableChips[targetIndex];
      chipRefs.current[targetIndex]?.focus();
      handleChipClick(targetChip);
    }
  };

  return (
    <div
      data-testid={testId}
      role="radiogroup"
      aria-label="Quick wager chip selector"
      className={`quick-wager-chip-selector ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 16px',
        backgroundColor: '#0F172A',
        borderRadius: '9999px',
        border: '1px solid #1E293B',
        boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      {availableChips.map((chipValue, index) => {
        const isSelected = selectedAmount === chipValue;
        const isDisabled = chipValue > userBalance;
        const theme = getChipTheme(chipValue);

        return (
          <button
            key={chipValue}
            ref={(el) => {
              chipRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-disabled={isDisabled}
            aria-label={`${chipValue} XLM chip${isDisabled ? ' (exceeds balance)' : ''}`}
            disabled={isDisabled}
            tabIndex={isSelected || (!selectedAmount && index === 0) ? 0 : -1}
            data-testid={`quick-wager-chip-${chipValue}`}
            data-value={chipValue}
            data-selected={isSelected}
            data-disabled={isDisabled}
            onClick={() => handleChipClick(chipValue)}
            onDoubleClick={() => handleChipDoubleClick(chipValue)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              position: 'relative',
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: theme.bg,
              border: `2px solid ${theme.border}`,
              color: theme.textColor,
              fontSize: '13px',
              fontWeight: 700,
              fontFamily: 'monospace, sans-serif',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.38 : 1,
              filter: isDisabled ? 'grayscale(0.6)' : 'none',
              transform: isSelected ? 'scale(1.12) translateY(-2px)' : 'scale(1)',
              transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: 'none',
              boxShadow: isSelected
                ? `0 0 0 3px #38BDF8, 0 8px 16px -2px ${theme.glowColor}`
                : '0 4px 6px -1px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.3)',
              userSelect: 'none',
            }}
          >
            {/* Tactile dashed edge rim notches */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: '3px',
                borderRadius: '50%',
                border: `1.5px dashed ${theme.innerRing}`,
                pointerEvents: 'none',
              }}
            />
            {/* Chip face value */}
            <span
              style={{
                position: 'relative',
                zIndex: 1,
                letterSpacing: '-0.5px',
                textShadow: theme.textColor === '#FFFFFF' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
              }}
            >
              {chipValue}
            </span>
          </button>
        );
      })}
    </div>
  );
};
