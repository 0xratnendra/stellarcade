import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { QuestCountdownTimerWidget, computeRemainingTime, formatRemainingTime } from './QuestCountdownTimerWidget';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. formatted time output for remaining hours and minutes
// ---------------------------------------------------------------------------

describe('computeRemainingTime / formatRemainingTime', () => {
  it('computes hours, minutes, and seconds correctly', () => {
    const now = 0;
    const target = (2 * 3600 + 15 * 60 + 30) * 1000; // 02:15:30
    const remaining = computeRemainingTime(now, target);
    expect(remaining.hours).toBe(2);
    expect(remaining.minutes).toBe(15);
    expect(remaining.seconds).toBe(30);
    expect(remaining.expired).toBe(false);
  });

  it('formats as zero-padded HH:MM:SS', () => {
    const remaining = computeRemainingTime(0, (1 * 3600 + 5 * 60 + 9) * 1000);
    expect(formatRemainingTime(remaining)).toBe('01:05:09');
  });

  it('clamps at zero rather than going negative when target is in the past', () => {
    const remaining = computeRemainingTime(10_000, 5_000);
    expect(remaining.totalMs).toBe(0);
    expect(remaining.expired).toBe(true);
    expect(formatRemainingTime(remaining)).toBe('00:00:00');
  });
});

describe('QuestCountdownTimerWidget: formatted time output', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('renders the formatted HH:MM:SS clock', () => {
    const target = (3 * 3600 + 2 * 60 + 1) * 1000;
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    expect(screen.getByTestId('quest-countdown-clock')).toHaveTextContent('03:02:01');
  });

  it('accepts an ISO timestamp string as the target', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    render(<QuestCountdownTimerWidget targetResetTimestamp="2026-01-01T01:00:00.000Z" />);
    expect(screen.getByTestId('quest-countdown-clock')).toHaveTextContent('01:00:00');
  });

  it('updates the displayed time as ticks elapse, without drifting', () => {
    const target = 5000;
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    expect(screen.getByTestId('quest-countdown-clock')).toHaveTextContent('00:00:05');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('quest-countdown-clock')).toHaveTextContent('00:00:02');
  });
});

// ---------------------------------------------------------------------------
// 2. urgent class applied when remaining time is under 1 hour
// ---------------------------------------------------------------------------

describe('QuestCountdownTimerWidget: urgent class applied when remaining time is under 1 hour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('applies the urgent class when under 1 hour remains', () => {
    const target = 30 * 60 * 1000; // 30 minutes
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    expect(screen.getByTestId('quest-countdown-widget')).toHaveClass('quest-countdown-widget--urgent');
  });

  it('does not apply the urgent class when 1 hour or more remains', () => {
    const target = 2 * 60 * 60 * 1000; // 2 hours
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    expect(screen.getByTestId('quest-countdown-widget')).not.toHaveClass('quest-countdown-widget--urgent');
  });

  it('transitions into the urgent state as time elapses past the 1-hour boundary', () => {
    const target = 60 * 60 * 1000 + 2000; // just over 1 hour
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    expect(screen.getByTestId('quest-countdown-widget')).not.toHaveClass('quest-countdown-widget--urgent');

    act(() => {
      vi.advanceTimersByTime(3000); // now under 1 hour remains
    });
    expect(screen.getByTestId('quest-countdown-widget')).toHaveClass('quest-countdown-widget--urgent');
  });

  it('does not apply the urgent class once expired (expired state takes precedence)', () => {
    const target = 500;
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('quest-countdown-widget')).not.toHaveClass('quest-countdown-widget--urgent');
    expect(screen.getByTestId('quest-countdown-expired')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 3. expiration callback triggered at zero seconds
// ---------------------------------------------------------------------------

describe('QuestCountdownTimerWidget: expiration callback triggered at zero seconds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('calls onExpire exactly once when the countdown reaches zero', () => {
    const onExpire = vi.fn();
    const target = 3000;
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} onExpire={onExpire} />);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000); // now past the target
    });
    expect(onExpire).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000); // further ticks after expiry must not re-fire
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('renders the "Refreshing quests..." banner once expired', () => {
    const target = 1000;
    render(<QuestCountdownTimerWidget targetResetTimestamp={target} />);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId('quest-countdown-expired')).toHaveTextContent(/Refreshing quests/);
    expect(screen.queryByTestId('quest-countdown-clock')).not.toBeInTheDocument();
  });

  it('does not call onExpire if the widget unmounts before expiry', () => {
    const onExpire = vi.fn();
    const { unmount } = render(<QuestCountdownTimerWidget targetResetTimestamp={5000} onExpire={onExpire} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cleanup on unmount
// ---------------------------------------------------------------------------

describe('QuestCountdownTimerWidget: cleans up interval timer on unmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('clears its interval when unmounted', () => {
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = render(<QuestCountdownTimerWidget targetResetTimestamp={10000} />);
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// label
// ---------------------------------------------------------------------------

describe('QuestCountdownTimerWidget: label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('renders an optional label', () => {
    render(<QuestCountdownTimerWidget targetResetTimestamp={5000} label="Daily Quest Reset" />);
    expect(screen.getByText('Daily Quest Reset')).toBeInTheDocument();
  });
});
