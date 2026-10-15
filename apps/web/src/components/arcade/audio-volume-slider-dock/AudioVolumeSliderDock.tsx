import React, { useState, useEffect, useRef } from 'react';
import type { AudioVolumeSliderDockProps } from './types';

const PRESET_LEVELS = [0, 25, 50, 75, 100];

export const AudioVolumeSliderDock: React.FC<AudioVolumeSliderDockProps> = ({
  initialVolume = 75,
  isMuted = false,
  onVolumeChange,
  onToggleMute,
  storageKey = 'stellarcade_volume_preference',
  position = 'bottom-right',
  className = '',
  testId = 'audio-volume-slider-dock',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [volume, setVolume] = useState<number>(initialVolume);
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  // Safe localStorage read on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(storageKey);
        if (stored !== null) {
          const parsed = parseInt(stored, 10);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
            setVolume(parsed);
            onVolumeChange(parsed);
          }
        }
      }
    } catch {
      // Safe fallback when localStorage is blocked or restricted
    }
  }, [storageKey, onVolumeChange]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSliderChange = (newVal: number) => {
    const clamped = Math.max(0, Math.min(100, newVal));
    setVolume(clamped);
    onVolumeChange(clamped);

    // Safe localStorage write
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(storageKey, clamped.toString());
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  };

  const isSoundActive = !isMuted && volume > 0;

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      className={`audio-volume-slider-dock ${className}`}
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
    >
      {/* Floating Dock Trigger Button */}
      <button
        type="button"
        data-testid={`${testId}-trigger`}
        aria-label={isMuted ? 'Audio muted. Open volume dock' : `Volume ${volume}%. Open volume dock`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        style={{
          width: '44px',
          height: '44px',
          borderRadius: '50%',
          backgroundColor: '#0F172A',
          border: isSoundActive ? '2px solid #38BDF8' : '2px solid #334155',
          color: isSoundActive ? '#38BDF8' : '#94A3B8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: isSoundActive
            ? '0 0 14px rgba(56, 189, 248, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.15)'
            : '0 4px 6px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          outline: 'none',
        }}
      >
        {/* Animated Sound Wave Icon or Muted Icon */}
        {isMuted || volume === 0 ? (
          <svg
            data-testid={`${testId}-muted-icon`}
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <div
            data-testid={`${testId}-wave-icon`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              height: '16px',
            }}
          >
            {/* 3 Animated Sound Wave Bars */}
            <span
              style={{
                width: '3px',
                height: '8px',
                backgroundColor: 'currentColor',
                borderRadius: '2px',
                animation: isSoundActive ? 'pulse 0.8s ease-in-out infinite' : 'none',
              }}
            />
            <span
              style={{
                width: '3px',
                height: '16px',
                backgroundColor: 'currentColor',
                borderRadius: '2px',
                animation: isSoundActive ? 'pulse 1.1s ease-in-out infinite alternate' : 'none',
              }}
            />
            <span
              style={{
                width: '3px',
                height: '11px',
                backgroundColor: 'currentColor',
                borderRadius: '2px',
                animation: isSoundActive ? 'pulse 0.9s ease-in-out infinite 0.2s' : 'none',
              }}
            />
          </div>
        )}
      </button>

      {/* Expandable Volume Popover Panel */}
      {isOpen && (
        <div
          data-testid={`${testId}-popover`}
          role="dialog"
          aria-label="Volume controls"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          style={{
            position: 'absolute',
            bottom: position.startsWith('bottom') ? 'calc(100% + 10px)' : 'auto',
            top: position.startsWith('top') ? 'calc(100% + 10px)' : 'auto',
            right: position.endsWith('right') ? 0 : 'auto',
            left: position.endsWith('left') ? 0 : 'auto',
            zIndex: 60,
            width: '240px',
            backgroundColor: '#0F172A',
            border: '1px solid #1E293B',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.6), 0 0 15px rgba(56, 189, 248, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* Header Row: Title & Mute Button */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#94A3B8',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Master Audio
            </span>
            <button
              type="button"
              data-testid={`${testId}-mute-button`}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              onClick={onToggleMute}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '6px',
                backgroundColor: isMuted ? '#EF4444' : '#1E293B',
                color: isMuted ? '#FFFFFF' : '#38BDF8',
                border: isMuted ? '1px solid #DC2626' : '1px solid #334155',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {isMuted ? 'Muted' : 'Mute'}
            </button>
          </div>

          {/* Volume Slider Control */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#64748B',
                fontFamily: 'monospace',
              }}
            >
              <span>0%</span>
              <span
                data-testid={`${testId}-level-text`}
                style={{
                  color: isMuted ? '#EF4444' : '#38BDF8',
                  fontWeight: 700,
                }}
              >
                {isMuted ? 'Muted' : `${volume}%`}
              </span>
              <span>100%</span>
            </div>

            <input
              ref={sliderRef}
              type="range"
              min={0}
              max={100}
              value={volume}
              role="slider"
              aria-label="Volume slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volume}
              aria-valuetext={isMuted ? 'Muted' : `${volume}%`}
              data-testid={`${testId}-slider`}
              onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
              style={{
                width: '100%',
                height: '6px',
                borderRadius: '4px',
                appearance: 'none',
                backgroundColor: '#334155',
                outline: 'none',
                cursor: 'pointer',
                accentColor: '#38BDF8',
              }}
            />
          </div>

          {/* Preset Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '4px',
              paddingTop: '4px',
              borderTop: '1px solid #1E293B',
            }}
          >
            {PRESET_LEVELS.map((preset) => (
              <button
                key={preset}
                type="button"
                data-testid={`${testId}-preset-${preset}`}
                onClick={() => handleSliderChange(preset)}
                style={{
                  flex: 1,
                  padding: '3px 0',
                  fontSize: '10px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  borderRadius: '4px',
                  backgroundColor: volume === preset && !isMuted ? '#1E293B' : 'transparent',
                  color: volume === preset && !isMuted ? '#38BDF8' : '#64748B',
                  border: volume === preset && !isMuted ? '1px solid #38BDF8' : '1px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {preset}%
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
